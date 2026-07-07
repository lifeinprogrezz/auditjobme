// Phase B (overnight-job-hunter, spec 2026-07-07 §7) — the nightly matches loop.
// A Vercel cron serverless function (Node runtime), SEPARATE from the Vite bundle
// (nothing under src/ imports this; it is never pulled into the client). It:
//   active users → new jobs since their last batch → labelled slice → score the
//   top-N via the anthropic-proxy edge fn (service-role, target_user_id) → rank →
//   upsert daily_matches (idempotent) → one Resend "N roles ready" email.
// Slice 1 = SCORING ONLY. No CV/cover/audit generation, no in-app /matches view.
//
// Env (from the Supabase↔Vercel integration + Rober's Vercel env):
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — Supabase server access (service role).
//   RESEND_API_KEY — transactional email. CRON_SECRET — cron-caller auth (Vercel
//   sends it as `Authorization: Bearer <CRON_SECRET>`).
import { createClient } from "@supabase/supabase-js";
import { pickScoringSlice } from "../src/lib/labels.js";
import { SYSTEM, buildScoreUserMessage, parseScoreResponse } from "../src/lib/scorePrompt.js";
import {
  NIGHTLY_TOP_N,
  cronAuthResult,
  selectNightlyCandidates,
  decideNightlyAction,
  rankMatches,
  buildEmailSubject,
  buildEmailBody,
  type NightlyJob,
  type ScoredMatch,
  type RankedMatch,
} from "../src/lib/nightly.js";

// Minimal Vercel Node handler types (avoids a @vercel/node dependency).
type Req = { method?: string; headers: Record<string, string | string[] | undefined> };
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

const APP_URL = "https://auditjob.me/";
const EMAIL_FROM = "AuditJob.me <matches@lifeinprogrezz.com>";
const HAIKU = "claude-haiku-4-5-20251001";
const JOB_FETCH_LIMIT = 800; // recent-jobs candidate window (newest first)

const env = (k: string) => process.env[k];

/** One row per scored role, ready to upsert. */
type MatchRow = {
  user_id: string;
  job_url: string;
  rank: number;
  score: number;
  reason: string;
  fit_bullets: string[];
  batch_date: string;
};

/** Discriminated result: a parsed score, a cap (429 → stop the user gracefully),
 *  or a skip (transient failure → drop just this job). */
type ScoreResult =
  | { kind: "ok"; score: number; reason: string; fitBullets: string[] }
  | { kind: "capped" }
  | { kind: "skip" };

/** Score one job for one user through the edge fn's service-role path. */
async function scoreViaProxy(
  proxyUrl: string,
  serviceKey: string,
  targetUserId: string,
  system: string,
  userMsg: string,
): Promise<ScoreResult> {
  let res: Response;
  try {
    res = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: "score",
        model: HAIKU,
        max_tokens: 500,
        system,
        target_user_id: targetUserId,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
  } catch (e) {
    console.warn("[nightly] proxy fetch failed:", e);
    return { kind: "skip" };
  }
  if (res.status === 429) return { kind: "capped" };
  if (!res.ok) {
    console.warn(`[nightly] proxy non-ok ${res.status}`);
    return { kind: "skip" };
  }
  const data = (await res.json().catch(() => null)) as
    | { content?: { type?: string; text?: string }[] }
    | null;
  // Find the first TEXT block (a response can lead with a non-text block); fall
  // back to content[0] for the plain single-text-block shape.
  const textBlock = Array.isArray(data?.content)
    ? (data.content.find((b) => b?.type === "text") ?? data.content[0])
    : null;
  const parsed = parseScoreResponse(textBlock?.text ?? "");
  // Observability: a 200 that doesn't parse is a SILENT zero-match otherwise.
  if (!parsed) console.warn("[nightly] unparseable score response — skipping job");
  return parsed ? { kind: "ok", ...parsed } : { kind: "skip" };
}

/** Fire one Resend notification. Fail-soft: logs + returns false, never throws. */
async function sendEmail(
  apiKey: string,
  to: string,
  subject: string,
  body: { text: string; html: string },
): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, text: body.text, html: body.html }),
    });
    if (!res.ok) {
      console.warn(`[nightly] Resend ${res.status}:`, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[nightly] Resend fetch failed:", e);
    return false;
  }
}


export default async function handler(req: Req, res: Res): Promise<void> {
  // ── Cron-caller auth (fail CLOSED) ────────────────────────────────────────
  // Vercel Cron invokes this endpoint over GET with `Authorization: Bearer
  // <CRON_SECRET>`. A MISSING CRON_SECRET is a misconfiguration (500), NOT a
  // bypass — otherwise the worker would be publicly triggerable. Method is not
  // part of the auth check: do NOT restrict to POST or the cron GET breaks.
  const authError = cronAuthResult(env("CRON_SECRET"), req.headers["authorization"]);
  if (authError) {
    res.status(authError.status).json({ error: authError.error });
    return;
  }

  // SUPABASE_URL is a SERVER-side var. There is intentionally no VITE_ fallback:
  // VITE_-prefixed vars are inlined into the client bundle at build time and are
  // NEVER present in process.env at Function runtime, so a fallback would only
  // mask a genuinely-unset var. Fail fast + honestly instead.
  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = env("RESEND_API_KEY");
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
    return;
  }
  const proxyUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/anthropic-proxy`;
  const admin = createClient(supabaseUrl, serviceKey);
  const today = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();

  // Send the "N roles ready" email for a persisted batch and, on send-success,
  // stamp notified_at so the same-day early-exit (B3) treats the user as done.
  // Shared by the fresh-score path and the email-retry path. Fail-soft → bool.
  // Local closure (not module-level) so it captures `admin`'s inferred client type.
  const sendBatchEmail = async (
    key: string,
    userId: string,
    batchDate: string,
    ranked: RankedMatch[],
  ): Promise<boolean> => {
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const to = authUser?.user?.email;
    if (!to) return false;
    const sent = await sendEmail(key, to, buildEmailSubject(ranked.length), buildEmailBody(ranked, APP_URL));
    if (sent) {
      await admin
        .from("daily_matches")
        .update({ notified_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("batch_date", batchDate);
    }
    return sent;
  };

  // ── Active users: a CV plus at least one role/industry label ──────────────
  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select(
      "id, cv_text, target_roles, target_sectors, target_seniority, target_cities, open_to_remote, citizenship, eu_work_authorized, languages",
    );
  if (pErr) {
    res.status(500).json({ error: `profiles read failed: ${pErr.message}` });
    return;
  }
  const active = (profiles ?? []).filter(
    (p) =>
      typeof p.cv_text === "string" &&
      p.cv_text.trim().length > 0 &&
      ((p.target_roles?.length ?? 0) > 0 || (p.target_sectors?.length ?? 0) > 0),
  );

  // ── Candidate jobs (newest first) + company→sector for the label slice ────
  const { data: jobRows, error: jErr } = await admin
    .from("jobs")
    .select("id, company, company_id, title, url, location, remote, seniority, jd_text, first_seen_at, posted_at")
    .eq("is_live", true)
    .order("first_seen_at", { ascending: false })
    .limit(JOB_FETCH_LIMIT);
  if (jErr) {
    res.status(500).json({ error: `jobs read failed: ${jErr.message}` });
    return;
  }
  const { data: cos } = await admin.from("companies").select("slug, sector");
  const sectorBySlug = new Map<string, string | null>();
  (cos ?? []).forEach((c) => sectorBySlug.set(c.slug, c.sector));
  const jobs: NightlyJob[] = (jobRows ?? []).map((r) => ({
    id: r.id,
    company: r.company,
    title: r.title,
    url: r.url,
    location: r.location,
    remote: r.remote,
    seniority: r.seniority,
    jd_text: r.jd_text,
    sector: r.company_id ? (sectorBySlug.get(r.company_id) ?? null) : null,
    first_seen_at: r.first_seen_at,
    posted_at: r.posted_at,
  }));
  // url → {company,title} for rebuilding the email preview on the retry-email path
  // (daily_matches stores only job_url, not the display fields).
  const jobByUrl = new Map(jobs.map((j) => [j.url, { company: j.company, title: j.title }]));

  const summary = { users: active.length, processed: 0, skipped: 0, emailed: 0, capped: 0, matches: 0 };

  for (const p of active) {
    const userId = p.id as string;
    try {
      // Every prior daily_matches row for this user (small: ≤ NIGHTLY_TOP_N per
      // night). Drives three decisions: today's batch state (B3 notified-split),
      // the created_at cutoff (B2), and the already-matched-URL exclusion (B2).
      const { data: existingRows } = await admin
        .from("daily_matches")
        .select("job_url, rank, score, reason, fit_bullets, batch_date, created_at, notified_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      const rowsForUser = existingRows ?? [];
      const todaysRows = rowsForUser.filter((r) => r.batch_date === today);
      const action = decideNightlyAction(todaysRows);

      // Already matched AND already notified today → fully done, no cost.
      if (action === "skip") {
        summary.skipped++;
        continue;
      }

      // Matched today but the email never confirmed (soft send failure left
      // notified_at NULL) → retry the send for the EXISTING batch. Do NOT
      // re-score / re-upsert — email is the only channel this slice.
      if (action === "retry-email") {
        summary.skipped++; // the batch already exists; nothing re-processed
        if (resendKey) {
          const rankedRetry: RankedMatch[] = todaysRows
            .slice()
            .sort((a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0))
            .map((r) => {
              const url = r.job_url as string;
              const meta = jobByUrl.get(url);
              return {
                url,
                company: meta?.company ?? url,
                title: meta?.title ?? "New role",
                score: Number(r.score) || 0,
                reason: (r.reason as string | null) ?? "",
                fitBullets: Array.isArray(r.fit_bullets) ? (r.fit_bullets as string[]) : [],
                rank: Number(r.rank) || 0,
              };
            });
          if (rankedRetry.length > 0 && (await sendBatchEmail(resendKey, userId, today, rankedRetry))) {
            summary.emailed++;
          }
        }
        continue;
      }

      // action === "score": no batch today → run the full pass.
      // "New since last batch": the most recent PRIOR batch's created_at (a real
      // timestamptz — NOT batch_date, whose 00:00-UTC parse would re-select every
      // job first seen in the 00:00–06:00 window each night). No prior row → the
      // ~24h fallback window. seenUrls = every URL already matched, ever, so a
      // cutoff regression or schedule change can never re-notify a seen role.
      const sinceIso = (rowsForUser[0]?.created_at as string | null) ?? null;
      const seenUrls = new Set(rowsForUser.map((r) => r.job_url as string));

      const fresh = selectNightlyCandidates(jobs, sinceIso, nowMs, seenUrls);
      const slice = pickScoringSlice(fresh, {
        roles: (p.target_roles as string[]) ?? [],
        sectors: (p.target_sectors as string[]) ?? [],
      });
      const candidates = slice.slice(0, NIGHTLY_TOP_N);
      if (candidates.length === 0) {
        summary.processed++;
        continue;
      }

      const profile = {
        target_seniority: (p.target_seniority as string | null) ?? null,
        target_cities: (p.target_cities as string[] | null) ?? null,
        open_to_remote: (p.open_to_remote as boolean | null) ?? null,
        citizenship: (p.citizenship as string | null) ?? null,
        eu_work_authorized: (p.eu_work_authorized as boolean | null) ?? null,
        languages: (p.languages as string[] | null) ?? null,
        cv_text: (p.cv_text as string | null) ?? null,
      };

      const scored: ScoredMatch[] = [];
      let capped = false;
      for (const j of candidates) {
        const userMsg = buildScoreUserMessage(profile, {
          id: j.id,
          company: j.company,
          title: j.title,
          location: j.location ?? null,
          remote: Boolean(j.remote),
          seniority: j.seniority ?? null,
          jd_text: j.jd_text ?? null,
        });
        const r = await scoreViaProxy(proxyUrl, serviceKey, userId, SYSTEM, userMsg);
        if (r.kind === "capped") {
          capped = true;
          summary.capped++;
          break; // stop this user gracefully; the cap is not fatal to the run
        }
        if (r.kind === "skip") continue;
        scored.push({
          url: j.url,
          company: j.company,
          title: j.title,
          score: r.score,
          reason: r.reason,
          fitBullets: r.fitBullets,
        });
      }

      summary.processed++;
      if (scored.length === 0) continue;

      const ranked = rankMatches(scored);
      const rows: MatchRow[] = ranked.map((m) => ({
        user_id: userId,
        job_url: m.url,
        rank: m.rank,
        score: m.score,
        reason: m.reason,
        fit_bullets: m.fitBullets,
        batch_date: today,
      }));
      const { error: upErr } = await admin
        .from("daily_matches")
        .upsert(rows, { onConflict: "user_id,job_url,batch_date" });
      if (upErr) {
        console.warn(`[nightly] upsert failed for ${userId}:`, upErr.message);
        continue;
      }
      summary.matches += rows.length;

      // ── Email (fail-soft). Only when we actually persisted ≥1 match. On a soft
      // send failure notified_at stays NULL, so a same-day re-run retries the send
      // (B3) rather than skipping the user forever. ────────────────────────────
      if (resendKey && (await sendBatchEmail(resendKey, userId, today, ranked))) {
        summary.emailed++;
      }
      void capped;
    } catch (e) {
      console.warn(`[nightly] user ${userId} failed:`, e);
    }
  }

  res.status(200).json({ ok: true, date: today, ...summary });
}
