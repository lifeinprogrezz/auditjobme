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
import type { RoleJob } from "../src/lib/roles";
import { pickScoringSlice } from "../src/lib/labels";
import { SYSTEM, buildScoreUserMessage, parseScoreResponse } from "../src/lib/scorePrompt";
import {
  NIGHTLY_TOP_N,
  selectNewJobsSince,
  rankMatches,
  buildEmailSubject,
  buildEmailBody,
  type NightlyJob,
  type ScoredMatch,
} from "../src/lib/nightly";

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
  const data = (await res.json().catch(() => null)) as { content?: { text?: string }[] } | null;
  const parsed = parseScoreResponse(data?.content?.[0]?.text ?? "");
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
  // ── Cron-caller auth ──────────────────────────────────────────────────────
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is
  // set in the project env. Reject anything else so the endpoint isn't publicly
  // triggerable. (If CRON_SECRET is unset the check is skipped — set it in Vercel.)
  const cronSecret = env("CRON_SECRET");
  if (cronSecret) {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const supabaseUrl = env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
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

  const summary = { users: active.length, processed: 0, skipped: 0, emailed: 0, capped: 0, matches: 0 };

  for (const p of active) {
    const userId = p.id as string;
    try {
      // Idempotency: if a batch already exists for this user today, skip entirely
      // (re-run is a no-op and costs nothing). The UNIQUE(user,job_url,date) guards
      // the row level too, but skipping avoids re-scoring cost.
      const { data: existing } = await admin
        .from("daily_matches")
        .select("id")
        .eq("user_id", userId)
        .eq("batch_date", today)
        .limit(1);
      if (existing && existing.length > 0) {
        summary.skipped++;
        continue;
      }

      // "New since last batch": the user's most recent prior batch_date, else the
      // ~24h fallback window.
      const { data: last } = await admin
        .from("daily_matches")
        .select("batch_date")
        .eq("user_id", userId)
        .order("batch_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const sinceIso = (last?.batch_date as string | null) ?? null;

      const fresh = selectNewJobsSince(jobs, sinceIso, nowMs);
      const slice = pickScoringSlice(fresh as unknown as RoleJob[], {
        roles: (p.target_roles as string[]) ?? [],
        sectors: (p.target_sectors as string[]) ?? [],
      }) as unknown as NightlyJob[];
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

      // ── Email (fail-soft). Only when we actually persisted ≥1 match and the
      // caps didn't stop us mid-run for nothing. ──────────────────────────────
      if (resendKey) {
        const { data: authUser } = await admin.auth.admin.getUserById(userId);
        const to = authUser?.user?.email;
        if (to) {
          const sent = await sendEmail(
            resendKey,
            to,
            buildEmailSubject(rows.length),
            buildEmailBody(ranked, APP_URL),
          );
          if (sent) {
            summary.emailed++;
            await admin
              .from("daily_matches")
              .update({ notified_at: new Date().toISOString() })
              .eq("user_id", userId)
              .eq("batch_date", today);
          }
        }
      }
      void capped;
    } catch (e) {
      console.warn(`[nightly] user ${userId} failed:`, e);
    }
  }

  res.status(200).json({ ok: true, date: today, ...summary });
}
