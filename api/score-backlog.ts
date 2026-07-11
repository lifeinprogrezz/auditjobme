// Server-side scoring backlog worker (issue #33) — sibling of api/nightly.ts.
// Scores every user's UNSCORED live roles into `scores` (the exact shape /roles
// reads) without the user being on the page, then sends ONE "your roles are
// scored" email when their backlog hits zero. Invoked every 10 minutes by
// .github/workflows/score-backlog.yml (Vercel Hobby crons are daily-only);
// each invocation processes a ~45s time-budgeted chunk and the next tick
// resumes — idempotent by construction (the backlog predicate is "no scores
// row at the current rubric version", and every landed score upserts).
// Spec: planning repo docs/specs/2026-07-10-server-side-scoring-backlog-design.md
//
// Env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / RESEND_API_KEY / CRON_SECRET
// (same contract as api/nightly.ts).
import { createClient } from "@supabase/supabase-js";
import { SYSTEM, SCORE_MAX_TOKENS, buildScoreUserMessage, parseScoreResponse, RUBRIC_VERSION, type ParsedScore } from "../src/lib/scorePrompt.js";
import { cronAuthResult } from "../src/lib/nightly.js";
import {
  RUN_BUDGET_MS,
  SCORE_CONCURRENCY,
  STRONG_SCORE,
  selectBacklog,
  runPool,
  shouldSendReadyEmail,
  buildReadySubject,
  buildReadyBody,
} from "../src/lib/scoreBacklog.js";

type Req = { method?: string; headers: Record<string, string | string[] | undefined> };
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

const APP_URL = "https://auditjob.me/";
const EMAIL_FROM = "AuditJob.me <matches@lifeinprogrezz.com>";
const HAIKU = "claude-haiku-4-5-20251001";
const PAGE = 1000; // PostgREST caps un-ranged selects at 1000 rows — page past it.
const JD_BATCH = 50; // jd_text is multi-KB: fetch it only for the rows about to score.

type LiveJob = {
  id: string;
  company: string;
  title: string;
  location: string | null;
  remote: boolean;
  seniority: string | null;
  extraction: { yoe_min?: number | null; geo_eligibility?: string | null } | null;
};

/** Score one job for one user through the proxy's service-role path. Never throws. */
async function scoreViaProxy(
  proxyUrl: string,
  serviceKey: string,
  targetUserId: string,
  userMsg: string,
): Promise<ParsedScore | null> {
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
        max_tokens: SCORE_MAX_TOKENS,
        system: SYSTEM,
        target_user_id: targetUserId,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
  } catch (e) {
    console.warn("[score-backlog] proxy fetch failed:", e);
    return null;
  }
  if (!res.ok) {
    console.warn(`[score-backlog] proxy non-ok ${res.status}`);
    return null;
  }
  const data = (await res.json().catch(() => null)) as
    | { content?: { type?: string; text?: string }[] }
    | null;
  const textBlock = Array.isArray(data?.content)
    ? (data.content.find((b) => b?.type === "text") ?? data.content[0])
    : null;
  return parseScoreResponse(textBlock?.text ?? "");
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
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject,
        text: body.text,
        html: body.html,
        headers: {
          "List-Unsubscribe": "<mailto:hello@lifeinprogrezz.com?subject=Unsubscribe%20AuditJob%20matches>",
        },
      }),
    });
    if (!res.ok) {
      console.warn(`[score-backlog] Resend ${res.status}:`, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[score-backlog] Resend fetch failed:", e);
    return false;
  }
}

export default async function handler(req: Req, res: Res): Promise<void> {
  const startedMs = Date.now();
  const deadlineMs = startedMs + RUN_BUDGET_MS;

  const authError = cronAuthResult(process.env.CRON_SECRET, req.headers["authorization"]);
  if (authError) {
    res.status(authError.status).json({ error: authError.error });
    return;
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
    return;
  }
  const proxyUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/anthropic-proxy`;
  const admin = createClient(supabaseUrl, serviceKey);

  // ── Users with a CV (the only requirement for a full-catalog pass) ─────────
  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select(
      "id, cv_text, target_seniority, target_cities, open_to_remote, citizenship, eu_work_authorized, languages, scores_ready_notified_at",
    );
  if (pErr) {
    res.status(500).json({ error: `profiles read failed: ${pErr.message}` });
    return;
  }
  const active = (profiles ?? []).filter(
    (p) => typeof p.cv_text === "string" && p.cv_text.trim().length > 0,
  );

  // ── Live catalog, WITHOUT jd_text (multi-KB; fetched per scoring batch) ────
  let liveJobs: LiveJob[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("jobs")
      .select("id, company, title, location, remote, seniority, extraction")
      .eq("is_live", true)
      .range(from, from + PAGE - 1);
    if (error) {
      res.status(500).json({ error: `jobs read failed: ${error.message}` });
      return;
    }
    liveJobs = liveJobs.concat((data ?? []) as LiveJob[]);
    if (!data || data.length < PAGE) break;
  }

  const summary = {
    users: active.length,
    scored: 0,
    failed: 0,
    emailed: 0,
    completed: 0,
    deadlineHit: false,
  };

  for (const p of active) {
    if (Date.now() >= deadlineMs) {
      summary.deadlineHit = true;
      break;
    }
    const userId = p.id as string;
    try {
      // Backlog predicate: live jobs with no scores row at the current rubric.
      // Paged read — a fully-scored catalog (~764 rows now, growing) would be
      // silently truncated by PostgREST's 1000-row default otherwise, making
      // scored rows look unscored and re-charging for them every tick.
      let scoredRows: { job_id: string; score: number | null }[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("scores")
          .select("job_id, score")
          .eq("user_id", userId)
          .eq("rubric_version", RUBRIC_VERSION)
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`scores read failed: ${error.message}`);
        scoredRows = scoredRows.concat(data ?? []);
        if (!data || data.length < PAGE) break;
      }
      const scoreByJob = new Map(scoredRows.map((r) => [r.job_id, r.score]));
      const backlog = selectBacklog(liveJobs, new Set(scoreByJob.keys()));

      if (backlog.length > 0) {
        const profile = {
          target_seniority: (p.target_seniority as string | null) ?? null,
          target_cities: (p.target_cities as string[] | null) ?? null,
          open_to_remote: (p.open_to_remote as boolean | null) ?? null,
          citizenship: (p.citizenship as string | null) ?? null,
          eu_work_authorized: (p.eu_work_authorized as boolean | null) ?? null,
          languages: (p.languages as string[] | null) ?? null,
          cv_text: (p.cv_text as string | null) ?? null,
        };

        // Score in jd-batches: fetch jd_text for ≤JD_BATCH rows, pool-score them,
        // upsert as each lands (a crash loses only in-flight calls). Failed calls
        // (parse/network) are NOT upserted, so the next tick retries them naturally.
        for (let i = 0; i < backlog.length && Date.now() < deadlineMs; i += JD_BATCH) {
          const batch = backlog.slice(i, i + JD_BATCH);
          const { data: jdRows, error: jdErr } = await admin
            .from("jobs")
            .select("id, jd_text")
            .in("id", batch.map((j) => j.id));
          if (jdErr) throw new Error(`jd_text read failed: ${jdErr.message}`);
          const jdById = new Map((jdRows ?? []).map((r) => [r.id, r.jd_text as string | null]));

          const { deadlineHit } = await runPool(batch, SCORE_CONCURRENCY, deadlineMs, async (j) => {
            const result = await scoreViaProxy(
              proxyUrl,
              serviceKey,
              userId,
              buildScoreUserMessage(profile, {
                id: j.id,
                company: j.company,
                title: j.title,
                location: j.location ?? null,
                remote: Boolean(j.remote),
                seniority: j.seniority ?? null,
                jd_text: jdById.get(j.id) ?? null,
                yoe_min: j.extraction?.yoe_min ?? null,
                geo_eligibility: j.extraction?.geo_eligibility ?? null,
              }),
            );
            if (!result) {
              summary.failed++;
              return;
            }
            const { error: upErr } = await admin.from("scores").upsert(
              {
                user_id: userId,
                job_id: j.id,
                score: result.score,
                rubric_version: RUBRIC_VERSION,
                signals: {
                  reason: result.reason,
                  fit_bullets: result.fitBullets,
                  subscores: result.subscores,
                  evidence: result.evidence,
                },
              },
              { onConflict: "user_id,job_id,rubric_version" },
            );
            if (upErr) {
              console.warn(`[score-backlog] upsert failed for ${userId}/${j.id}:`, upErr.message);
              summary.failed++;
              return;
            }
            scoreByJob.set(j.id, result.score); // feeds the in-memory completion math below
            summary.scored++;
          });
          if (deadlineHit) summary.deadlineHit = true;
        }
      }

      // ── Completion email (exactly once per pass) ──────────────────────────
      // Remaining is computed in memory over the LIVE set (pre-run rows + this
      // run's landed upserts): a DB count would also include rows for jobs that
      // have since gone dead and could fake a drained backlog. Failed calls
      // above landed no row, so they hold the pass open for the next tick —
      // never a false "ready" email.
      const remaining = liveJobs.filter((j) => !scoreByJob.has(j.id)).length;

      if (
        liveJobs.length > 0 &&
        shouldSendReadyEmail(remaining, (p.scores_ready_notified_at as string | null) ?? null)
      ) {
        summary.completed++;
        if (resendKey) {
          const strong = liveJobs.filter(
            (j) => Number(scoreByJob.get(j.id) ?? 0) >= STRONG_SCORE,
          ).length;
          const { data: authUser } = await admin.auth.admin.getUserById(userId);
          const to = authUser?.user?.email;
          if (
            to &&
            (await sendEmail(
              resendKey,
              to,
              buildReadySubject(strong ?? 0),
              buildReadyBody(strong ?? 0, liveJobs.length, APP_URL),
            ))
          ) {
            // Stamp ONLY on send-success so a soft Resend failure retries next tick.
            await admin
              .from("profiles")
              .update({ scores_ready_notified_at: new Date().toISOString() })
              .eq("id", userId);
            summary.emailed++;
          }
        }
      }
    } catch (e) {
      console.warn(`[score-backlog] user ${userId} failed:`, e);
    }
  }

  res.status(200).json({ ok: true, ms: Date.now() - startedMs, ...summary });
}
