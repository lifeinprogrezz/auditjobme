// Issue #75 — inbox → tracker auto-advance (Option A: forwarding address).
// A Node serverless function (Vercel), SEPARATE from the Vite bundle. The inbound
// email provider for northgoing.com (e.g. a Cloudflare Email Routing worker —
// external setup, see the PR body) POSTs each delivered message here as normalized
// JSON, authenticated with INBOUND_EMAIL_SECRET. The pipeline is:
//
//   recipient `u-{token}@northgoing.com` → inbound_tokens → user
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
//   to: string | string[] — recipient(s); one must be u-{token}@northgoing.com
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
  extractGmailConfirmationLink,
  isConfirmUrl,
  isGmailConfirmSuccess,
  isGmailForwardingConfirmation,
  matchApplication,
  secretAuthResult,
  senderDomain,
  type TrackedApp,
} from "../src/lib/inbound.js";
import { normStatus } from "../src/lib/tracker.js";
import { parseResendInboundEvent } from "../src/lib/inbound.js";
import { verifySvixSignature } from "../src/lib/svix.js";
// #145: thrown errors + the Resend non-ok line go to Sentry (ids and counts only —
// see src/lib/apiSentry.ts; mail content never leaves). No DSN → no-op.
import { reportApiError, withSentry } from "../src/lib/apiSentry.js";

// Minimal Vercel Node handler types (avoids a @vercel/node dependency).
type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

// Svix signs the RAW bytes. Vercel's default JSON parsing re-serialises them, and a
// re-serialised body does not verify (key order and whitespace both move), so the
// parser is off and both providers are parsed by hand below.
export const config = { api: { bodyParser: false } };

/** The unmodified request body. Falls back to whatever Vercel already gave us if
 *  the stream was consumed upstream, so a runtime change cannot silently 500. */
async function readRawBody(req: Req): Promise<string> {
  const anyReq = req as unknown as AsyncIterable<Buffer> & { body?: unknown };
  if (typeof anyReq[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of anyReq) chunks.push(Buffer.from(chunk));
    if (chunks.length > 0) return Buffer.concat(chunks).toString("utf8");
  }
  if (typeof anyReq.body === "string") return anyReq.body;
  if (anyReq.body && typeof anyReq.body === "object") return JSON.stringify(anyReq.body);
  return "";
}

/** Exchange a Resend email_id for the content the webhook deliberately omits. */
async function fetchResendContent(
  emailId: string,
  apiKey: string,
): Promise<{ text?: string; html?: string; subject?: string } | null> {
  try {
    const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      console.warn(`[inbound] Resend content fetch ${r.status} for ${emailId}`);
      reportApiError(`[inbound] Resend content fetch non-ok ${r.status}`, { status: r.status, emailId });
      return null;
    }
    return (await r.json()) as { text?: string; html?: string; subject?: string };
  } catch (e) {
    console.warn("[inbound] Resend content fetch failed:", e);
    return null;
  }
}

/**
 * Issue #157 / LOCKED decision 7 (2026-08-26): follow the Gmail confirm link
 * server-side, so Settings can show "Confirmed" without the user clicking the
 * manual button. Callers MUST pass a url that already passed isConfirmUrl (see
 * the call site below) — this function makes the fetch, nothing else, and never
 * logs the url itself (only short, url-free messages). Best-effort: a timeout,
 * a network error, or a response that reads like Gmail rejected the link all
 * resolve false, never throw, so the manual button always stays a working
 * fallback. fetchImpl is injectable for tests, same shape as the liveness sweep
 * (scripts/liveness-lib.mjs checkUrl).
 */
export async function confirmGmailForwarding(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    // jsdom's AbortSignal (vitest environment) has no .timeout — degrade to no signal there.
    const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(10_000) : undefined;
    const res = await fetchImpl(url, { method: "GET", redirect: "follow", signal });
    const text = await res.text();
    return isGmailConfirmSuccess(res.status, text);
  } catch {
    return false;
  }
}

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

async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
    return;
  }

  // TWO providers, two trust boundaries. Resend signs with Svix over the raw bytes;
  // any other forwarder uses the shared bearer secret this endpoint was built for.
  // The provider is decided by the presence of Svix headers, never by the payload,
  // so a forged body cannot pick the weaker check for itself.
  const raw = await readRawBody(req);
  const parsed = safeParse(raw);
  const isSvix = Boolean(req.headers["svix-id"] || req.headers["svix-signature"]);

  let body: InboundPayload | null;
  if (isSvix) {
    const one = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h);
    const svixError = verifySvixSignature({
      id: one(req.headers["svix-id"]),
      timestamp: one(req.headers["svix-timestamp"]),
      signature: one(req.headers["svix-signature"]),
      rawBody: raw,
      secret: process.env.RESEND_WEBHOOK_SECRET,
      nowSec: Math.floor(Date.now() / 1000),
    });
    if (svixError) {
      res.status(svixError.status).json({ error: svixError.error });
      return;
    }
    const meta = parseResendInboundEvent(parsed);
    if (!meta) {
      // A delivery or bounce ping, not received mail. Acknowledged so Resend stops
      // retrying; ignoring it is the correct outcome, not an error.
      res.status(200).json({ ok: true, ignored: "not an email.received event" });
      return;
    }
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "RESEND_API_KEY not configured" });
      return;
    }
    // The webhook carries no body by design, so the content is a second call.
    const content = await fetchResendContent(meta.emailId, apiKey);
    body = {
      to: meta.to,
      from: meta.from,
      subject: content?.subject ?? meta.subject ?? undefined,
      text: content?.text,
      html: content?.html,
      messageId: meta.messageId ?? meta.emailId,
      date: meta.date ?? undefined,
    };
  } else {
    const authError = secretAuthResult(
      "INBOUND_EMAIL_SECRET",
      process.env.INBOUND_EMAIL_SECRET,
      req.headers["authorization"],
    );
    if (authError) {
      res.status(authError.status).json({ error: authError.error });
      return;
    }
    body = parsed as InboundPayload | null;
  }

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
    // Gmail sends a LINK, not a code (measured 2026-08-19). The code path stays
    // for the older "(#123456789)" subject some accounts still get, but the link
    // is what live mail actually carries, so it is read from the BODY.
    const code = extractGmailConfirmationCode(subject);
    const link = extractGmailConfirmationLink(text);
    if (code || link) {
      await admin
        .from("inbound_tokens")
        .update({
          ...(code ? { gmail_confirmation_code: code } : {}),
          ...(link ? { gmail_confirmation_url: link } : {}),
          gmail_confirmation_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    }

    // Auto-confirm: follow ONLY a url that passes isConfirmUrl (the extracted
    // /mail/vf-... link, never /mail/uf-...) and stamp gmail_confirmed_at on
    // success. Degrades gracefully in either direction: a fetch failure leaves
    // the column unset (the manual button in Settings stays the fallback), and
    // an environment where the migration hasn't landed yet (unknown-column error
    // on the update) is caught below rather than thrown.
    let confirmed = false;
    if (link && isConfirmUrl(link)) {
      confirmed = await confirmGmailForwarding(link);
      if (confirmed) {
        const { error: confirmErr } = await admin
          .from("inbound_tokens")
          .update({ gmail_confirmed_at: new Date().toISOString() })
          .eq("user_id", userId);
        if (confirmErr) {
          confirmed = false;
          console.warn("[inbound-email] gmail_confirmed_at stamp failed:", confirmErr.message);
        }
      }
    }

    const detail = link ? (confirmed ? "link stored; auto-confirmed" : "link stored") : code ? "code stored" : "no code or link found";
    await log({ classification: "gmail_confirmation", action: "gmail_confirmation", detail });
    res.status(200).json({ ok: true, action: "gmail_confirmation", stored: Boolean(code || link), confirmed });
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

export default withSentry("inbound-email", handler);

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
