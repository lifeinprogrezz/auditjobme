// Issue #75 — inbox → tracker auto-advance (Option A: forwarding address).
// A Node serverless function (Vercel), SEPARATE from the Vite bundle. The inbound
// email provider for track.northgoing.com (e.g. a Cloudflare Email Routing worker —
// external setup, see the PR body) POSTs each delivered message here as normalized
// JSON, authenticated with INBOUND_EMAIL_SECRET. The pipeline is:
//
//   recipient `u-{token}@track.northgoing.com` → inbound_tokens → user
//   → Gmail forwarding-confirmation? store the code on the token row (Settings shows it)
//   → classify (rejection | confirmation | interview) → fuzzy-match a tracked
//     application → stale-guarded transition (src/lib/inbound.ts, pinned by its test)
//   → write: UPDATE applications.status (the #77 status_events trigger events it,
//     identically to a manual kanban move) or stamp applications.confirmed_at
//   → always append one inbound_emails ledger row (classification metadata only,
//     never subject or body — privacy posture) — message_id makes redelivery a no-op.
//
// Payload contract (provider-agnostic; the forwarding worker maps into this):
//   POST { to, from, subject?, text?, html?, messageId?, date? }
//   to: string | string[] — recipient(s); one must be u-{token}@track.northgoing.com
//   from: string — the From header ("Acme Hiring" <no-reply@greenhouse.io>)
//   date: string — the Date header (RFC 2822 or ISO); powers the stale-guard
//
// Env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (Supabase↔Vercel integration) +
//   INBOUND_EMAIL_SECRET (shared with the forwarding worker; Vercel env).
import { createClient } from "@supabase/supabase-js";
import {
  atsFromSender,
  classifyInboundEmail,
  decideTransition,
  extractCompanyRole,
  extractForwardingToken,
  extractGmailConfirmationCode,
  isGmailForwardingConfirmation,
  matchApplication,
  secretAuthResult,
  senderDomain,
  type TrackedApp,
} from "../src/lib/inbound.js";
import { normStatus } from "../src/lib/tracker.js";

// Minimal Vercel Node handler types (avoids a @vercel/node dependency).
type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

type InboundPayload = {
  to?: string | string[];
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  date?: string;
};

/** Crude tag-strip for html-only mail — the classifier only needs phrases. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEmailDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const authError = secretAuthResult(
    "INBOUND_EMAIL_SECRET",
    process.env.INBOUND_EMAIL_SECRET,
    req.headers["authorization"],
  );
  if (authError) {
    res.status(authError.status).json({ error: authError.error });
    return;
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
    return;
  }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as InboundPayload | null;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "JSON body required" });
    return;
  }

  const token = extractForwardingToken(body.to);
  if (!token) {
    res.status(404).json({ error: "no forwarding recipient" });
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: tokenRow, error: tokenErr } = await admin
    .from("inbound_tokens")
    .select("user_id")
    .eq("token", token)
    .maybeSingle();
  if (tokenErr) {
    res.status(500).json({ error: `token lookup failed: ${tokenErr.message}` });
    return;
  }
  if (!tokenRow) {
    // Unknown token: drop silently (a 2xx keeps the provider from retrying a
    // delivery that will never resolve). Nothing is logged — there is no user.
    res.status(200).json({ ok: true, action: "dropped", reason: "unknown token" });
    return;
  }
  const userId = tokenRow.user_id as string;

  const from = body.from ?? "";
  const subject = body.subject ?? "";
  const text = body.text && body.text.trim() ? body.text : body.html ? htmlToText(body.html) : "";
  const messageId = body.messageId?.trim() || null;

  /** One ledger row per processed mail — metadata only, never subject/body. */
  const log = async (row: {
    classification: string;
    action: string;
    detail?: string | null;
    application_id?: string | null;
  }): Promise<void> => {
    const { error } = await admin.from("inbound_emails").insert({
      user_id: userId,
      message_id: messageId,
      from_domain: senderDomain(from),
      ats: atsFromSender(from),
      ...row,
    });
    // 23505 = unique violation on (user_id, message_id): concurrent redelivery.
    if (error && error.code !== "23505") console.warn("[inbound-email] ledger write failed:", error.message);
  };

  // Idempotency: a redelivered Message-ID was already processed — do nothing again.
  if (messageId) {
    const { data: dup } = await admin
      .from("inbound_emails")
      .select("id")
      .eq("user_id", userId)
      .eq("message_id", messageId)
      .maybeSingle();
    if (dup) {
      res.status(200).json({ ok: true, action: "duplicate" });
      return;
    }
  }

  // Gmail's add-forwarding-address verification lands HERE, not in the user's
  // inbox — park the code on the token row so Settings can show it back.
  if (isGmailForwardingConfirmation(from)) {
    const code = extractGmailConfirmationCode(subject);
    if (code) {
      await admin
        .from("inbound_tokens")
        .update({ gmail_confirmation_code: code, gmail_confirmation_at: new Date().toISOString() })
        .eq("user_id", userId);
    }
    await log({ classification: "gmail_confirmation", action: "gmail_confirmation", detail: code ? "code stored" : "no code found" });
    res.status(200).json({ ok: true, action: "gmail_confirmation", codeStored: Boolean(code) });
    return;
  }

  const kind = classifyInboundEmail({ subject, text });
  if (kind === "unknown") {
    await log({ classification: kind, action: "skipped", detail: "unclassified email" });
    res.status(200).json({ ok: true, action: "skipped", reason: "unclassified email" });
    return;
  }

  // The user's tracked applications, joined to their jobs for company + title.
  const { data: apps, error: appsErr } = await admin
    .from("applications")
    .select("id, status, confirmed_at, job_id, jobs:job_id (company, title)")
    .eq("user_id", userId);
  if (appsErr) {
    res.status(500).json({ error: `applications read failed: ${appsErr.message}` });
    return;
  }
  const rows: (TrackedApp & { confirmed_at: string | null })[] = (apps ?? []).flatMap((a) => {
    const job = a.jobs as unknown as { company?: string; title?: string } | null;
    if (!job?.company) return [];
    return [
      {
        id: a.id as string,
        status: a.status as string,
        confirmed_at: (a.confirmed_at as string | null) ?? null,
        company: job.company,
        title: job.title ?? "",
      },
    ];
  });

  const guess = extractCompanyRole(subject, from);
  const matched = matchApplication(rows, guess);
  if (!matched) {
    await log({ classification: kind, action: "no_match", detail: guess.company ? `no tracked application for "${guess.company}"` : "no company signal" });
    res.status(200).json({ ok: true, action: "no_match" });
    return;
  }

  const currentStatus = normStatus(matched.status);
  if (!currentStatus) {
    // Same no-coercion rule as the Tracker: never act on a status we can't identify.
    await log({ classification: kind, action: "skipped", detail: `unrecognised status "${matched.status}"`, application_id: matched.id });
    res.status(200).json({ ok: true, action: "skipped", reason: "unrecognised status" });
    return;
  }

  // The stale-guard's reference point: when this application last moved (#77 ledger).
  const { data: lastEvent } = await admin
    .from("status_events")
    .select("changed_at")
    .eq("application_id", matched.id)
    .order("changed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const decision = decideTransition({
    kind,
    currentStatus,
    emailDate: parseEmailDate(body.date),
    lastChangedAt: lastEvent?.changed_at ? new Date(lastEvent.changed_at) : null,
  });

  if (decision.action === "confirm") {
    if (matched.confirmed_at == null) {
      const { error } = await admin
        .from("applications")
        .update({ confirmed_at: parseEmailDate(body.date)?.toISOString() ?? new Date().toISOString() })
        .eq("id", matched.id)
        .is("confirmed_at", null); // stamped once, first confirmation wins
      if (error) {
        res.status(500).json({ error: `confirmed_at write failed: ${error.message}` });
        return;
      }
    }
    await log({ classification: kind, action: "confirmed", application_id: matched.id });
    res.status(200).json({ ok: true, action: "confirmed", applicationId: matched.id });
    return;
  }

  if (decision.action === "advance") {
    const { error } = await admin
      .from("applications")
      .update({ status: decision.to })
      .eq("id", matched.id)
      .eq("status", currentStatus); // no lost-update: only advance from the status we decided on
    if (error) {
      res.status(500).json({ error: `status write failed: ${error.message}` });
      return;
    }
    await log({ classification: kind, action: "advanced", detail: `${currentStatus} → ${decision.to}`, application_id: matched.id });
    res.status(200).json({ ok: true, action: "advanced", to: decision.to, applicationId: matched.id });
    return;
  }

  await log({ classification: kind, action: "skipped", detail: decision.reason, application_id: matched.id });
  res.status(200).json({ ok: true, action: "skipped", reason: decision.reason });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
