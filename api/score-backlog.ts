// Server-side scoring backlog worker (issue #33) — sibling of api/nightly.ts.
// Scores every user's UNSCORED slice of the live catalog — prefiltered to
// their labels and capped (#114, scorePrefilter.ts) — into `scores` (the exact shape /roles
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
import { buildScoreSystem, SCORE_MAX_TOKENS, buildScoreUserMessage, parseScoreResponse, RUBRIC_VERSION, type ParsedScore } from "../src/lib/scorePrompt.js";
import { cronAuthResult } from "../src/lib/nightly.js";
import { toScoresRow, SCORES_ON_CONFLICT } from "../src/lib/scoreLedger.js";
import { BRAND_NAME } from "../src/lib/brandName.js";
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
import { prefilterWithTier } from "../src/lib/scorePrefilter.js";
import { isDebounced, selectStaleRefresh, shouldRefreshStale, STALE_REFRESH_BUDGET } from "../src/lib/scoreRefresh.js";
import {
  SYNC_ONBOARDING_SLICE,
  buildBatchRequests,
  chunkForBatch,
  isMissingBatchTable,
  isBatchStale,
  parseBatchResults,
  partitionOnboarding,
} from "../src/lib/scoreBatch.js";

type Req = { method?: string; headers: Record<string, string | string[] | undefined> };
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

const APP_URL = "https://northgoing.com/";
// Display name only. The address stays on lifeinprogrezz.com, the Resend-verified
// domain — same split as api/nightly.ts, and both must move together.
const EMAIL_FROM = `${BRAND_NAME} <matches@northgoing.com>`;
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
  /** jobs.role_family (#34): selects the per-family scoring fit block. */
  role_family: string | null;
  /** Prefilter dimensions (#114): freshness ordering + the sector label match. */
  first_seen_at: string | null;
  posted_at: string | null;
  sector: string | null;
  /** jobs.has_jd (#130): the prefilter drops rows without a readable JD, so the
   *  multi-KB body is still fetched only per scoring batch. */
  has_jd: boolean | null;
};

/** Score one job for one user through the proxy's service-role path. Never throws.
 *  `sources` (the CV + JD this score is built from) grounds the cited evidence so a
 *  hallucinated quote is blanked before it is persisted into scores.signals. */
async function scoreViaProxy(
  proxyUrl: string,
  serviceKey: string,
  targetUserId: string,
  system: string,
  userMsg: string,
  sources: { cvText: string | null; jdText: string | null },
): Promise<ParsedScore | null> {
  let res: Response;
  try {
    res = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
        "x-region": "eu-central-1", // residency pin: edge fns run caller-near by default (S1)
      },
      body: JSON.stringify({
        kind: "score",
        model: HAIKU,
        max_tokens: SCORE_MAX_TOKENS,
        system,
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
  return parseScoreResponse(textBlock?.text ?? "", sources);
}

/** Call one of the proxy's service-role batch operations (issue #96, lever 2).
 *  Never throws — a batch hiccup must not cost the tick its synchronous work. */
async function proxyBatchOp(
  proxyUrl: string,
  serviceKey: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
        "x-region": "eu-central-1", // residency pin: edge fns run caller-near by default (S1)
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[score-backlog] proxy ${String(body.op)} non-ok ${res.status}`);
      return null;
    }
    return (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch (e) {
    console.warn(`[score-backlog] proxy ${String(body.op)} failed:`, e);
    return null;
  }
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
          "List-Unsubscribe": "<mailto:hello@lifeinprogrezz.com?subject=Unsubscribe%20Northgoing%20matches>",
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

  // ── Users with a CV (their pass covers the prefiltered slice, #114) ────────
  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select(
      "id, cv_text, cv_hash, cv_changed_at, stale_refreshed_at, target_roles, target_sectors, target_seniority, target_cities, open_to_remote, citizenship, eu_work_authorized, languages, scores_ready_notified_at",
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
      // sector lives on companies — embedded here so the prefilter's sector
      // dimension (#114) sees the same value the map's dataplane join carries.
      .select(
        "id, company, title, location, remote, seniority, extraction, role_family, first_seen_at, posted_at, has_jd, companies:company_id (sector)",
      )
      .eq("is_live", true)
      .range(from, from + PAGE - 1);
    if (error) {
      res.status(500).json({ error: `jobs read failed: ${error.message}` });
      return;
    }
    // The FK embed is an object at runtime (to-one), but the generated types
    // call it an array — tolerate both shapes rather than trusting either.
    type EmbeddedRow = Omit<LiveJob, "sector"> & {
      companies: { sector: string | null } | { sector: string | null }[] | null;
    };
    liveJobs = liveJobs.concat(
      ((data ?? []) as unknown as EmbeddedRow[]).map(({ companies, ...j }) => ({
        ...j,
        sector: (Array.isArray(companies) ? companies[0]?.sector : companies?.sector) ?? null,
      })),
    );
    if (!data || data.length < PAGE) break;
  }

  const summary = {
    users: active.length,
    scored: 0,
    batchScored: 0,
    submitted: 0,
    inFlight: 0,
    failed: 0,
    emailed: 0,
    completed: 0,
    deadlineHit: false,
    staleRefreshed: 0,
    batchAvailable: true,
  };

  // Migration 20260726103000 is applied by hand, so this code can run for a few
  // ticks before score_batches exists. The first missing-table read flips this off
  // for the whole run and every user falls back to the previous fully-synchronous
  // path — full price, but never a broken run.
  let batchAvailable = true;

  /** Upsert one batch's returned scores. Returns the job ids that actually landed —
   *  a role that failed to parse or upsert is deliberately NOT included, so it stays
   *  in the backlog and the next tick re-queues it. */
  const persistBatchResults = async (
    userId: string,
    jsonl: string,
    profile: { cv_text: string | null },
    jdByJob: Map<string, string | null>,
    cvHash: string | null,
  ): Promise<string[]> => {
    const landed: string[] = [];
    for (const r of parseBatchResults(jsonl)) {
      if (r.kind !== "succeeded") {
        summary.failed++; // no scores row → the next tick re-queues this role
        continue;
      }
      const jdText = jdByJob.get(r.customId) ?? null;
      // Identical validator + grounding as the synchronous path — a batch result is
      // the same model output, arriving later.
      const parsed = parseScoreResponse(r.text, { cvText: profile.cv_text, jdText });
      if (!parsed) {
        summary.failed++;
        continue;
      }
      // Row shape shared with the nightly's write-through (#135).
      const { error: upErr } = await admin
        .from("scores")
        .upsert(toScoresRow(userId, r.customId, parsed, cvHash), { onConflict: SCORES_ON_CONFLICT });
      if (upErr) {
        console.warn(`[score-backlog] batch upsert failed for ${userId}/${r.customId}:`, upErr.message);
        summary.failed++;
        continue;
      }
      landed.push(r.customId);
    }
    return landed;
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
      let scoredRows: { job_id: string; score: number | null; cv_hash: string | null }[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("scores")
          .select("job_id, score, cv_hash")
          .eq("user_id", userId)
          .eq("rubric_version", RUBRIC_VERSION)
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`scores read failed: ${error.message}`);
        scoredRows = scoredRows.concat(data ?? []);
        if (!data || data.length < PAGE) break;
      }
      const scoreByJob = new Map(scoredRows.map((r) => [r.job_id, r.score]));
      // A user's FIRST pass is the one somebody is watching. Captured BEFORE this
      // tick's work lands, so it stays true for the whole tick.
      const isFirstPass = scoredRows.length === 0;

      const profile = {
        target_seniority: (p.target_seniority as string | null) ?? null,
        target_cities: (p.target_cities as string[] | null) ?? null,
        open_to_remote: (p.open_to_remote as boolean | null) ?? null,
        citizenship: (p.citizenship as string | null) ?? null,
        eu_work_authorized: (p.eu_work_authorized as boolean | null) ?? null,
        languages: (p.languages as string[] | null) ?? null,
        cv_text: (p.cv_text as string | null) ?? null,
      };

      // #114: the deterministic prune — this user's paid pass covers ONLY the
      // slice their labels select (capped, newest-first). Backlog, completion
      // math, and the ready email all run over `eligible`; a pruned-out job
      // must never hold the pass open or be paid for. Label edits widen the
      // slice and manifest as new backlog on the next tick, no extra plumbing.
      const cvHash = (p.cv_hash as string | null) ?? null;

      const { jobs: eligible, tier } = prefilterWithTier(liveJobs, {
        roles: (p.target_roles as string[] | null) ?? [],
        sectors: (p.target_sectors as string[] | null) ?? [],
      });

      // ── Phase 1: retrieve anything this user already has in flight ──────────
      // Submission and retrieval are DIFFERENT cron ticks: a batch outlives the 60s
      // invocation that started it. Retrieval runs first so a drained batch frees
      // its job ids before the backlog for this tick is computed.
      const inFlightJobIds = new Set<string>();
      if (batchAvailable) {
        const { data: openBatches, error: obErr } = await admin
          .from("score_batches")
          .select("id, provider_batch_id, job_ids, rubric_version")
          .eq("user_id", userId)
          .eq("worker", "backlog")
          .eq("status", "submitted");
        if (obErr && isMissingBatchTable(obErr)) {
          console.warn("[score-backlog] score_batches missing — apply migration 20260726103000. Falling back to synchronous scoring.");
          batchAvailable = false;
          summary.batchAvailable = false;
        } else if (obErr) {
          throw new Error(`score_batches read failed: ${obErr.message}`);
        }
        for (const b of openBatches ?? []) {
          const jobIds = (b.job_ids as string[] | null) ?? [];
          // A rubric bump retires the batch: its judgments were produced under a
          // rubric the product has moved off. Retire the row so the ids are freed
          // and re-scored under the current rubric.
          if (isBatchStale(String(b.rubric_version), RUBRIC_VERSION)) {
            await admin.from("score_batches").update({ status: "failed", retrieved_at: new Date().toISOString() }).eq("id", b.id);
            continue;
          }
          const res = await proxyBatchOp(proxyUrl, serviceKey, {
            op: "batch_results",
            batch_id: b.provider_batch_id,
            target_user_id: userId,
            kind: "score",
          });
          const jsonl = res?.jsonl;
          if (typeof jsonl !== "string") {
            // Still processing (or a transient proxy failure) — keep it in flight so
            // this tick does not re-submit and re-pay for the same roles.
            jobIds.forEach((id) => inFlightJobIds.add(id));
            summary.inFlight += jobIds.length;
            continue;
          }
          const { data: jdRows } = await admin.from("jobs").select("id, jd_text").in("id", jobIds);
          const jdByJob = new Map((jdRows ?? []).map((r) => [r.id as string, r.jd_text as string | null]));
          const landed = await persistBatchResults(userId, jsonl, profile, jdByJob, cvHash);
          summary.batchScored += landed.length;
          // Feeds both the backlog predicate below and the completion math further
          // down, so a role scored by this tick's retrieval is not re-queued.
          landed.forEach((jobId) => scoreByJob.set(jobId, scoreByJob.get(jobId) ?? 0));
          await admin
            .from("score_batches")
            .update({ status: "retrieved", retrieved_at: new Date().toISOString() })
            .eq("id", b.id);
        }
      }

      // ── Phase 2: what is still unscored and not already in flight ───────────
      // Roles this user has never had scored at all.
      const unscored = selectBacklog(eligible, new Set(scoreByJob.keys())).filter(
        (j) => !inFlightJobIds.has(j.id),
      );

      // Roles whose score was computed from a PREVIOUS CV (#123). They already
      // show a real number, so they are not urgent; they are refreshed
      // highest-first on a per-pass budget, and only once editing has stopped.
      // A user who edits and never returns never has their long tail re-bought.
      const eligibleIds = new Set(eligible.map((j) => j.id));
      // Two gates, both required. The debounce waits for the user to stop
      // editing; the interval stops the every-10-minutes worker from draining
      // the whole tail in an afternoon, which a per-pass budget alone cannot do.
      const canRefreshStale =
        !isDebounced(p.cv_changed_at as string | null, Date.now()) &&
        shouldRefreshStale(p.stale_refreshed_at as string | null, Date.now());
      const staleIds = !canRefreshStale
        ? []
        : selectStaleRefresh(
            scoredRows.filter((r) => eligibleIds.has(r.job_id) && !inFlightJobIds.has(r.job_id)),
            cvHash,
            STALE_REFRESH_BUDGET,
          );
      const staleSet = new Set(staleIds);
      const staleJobs = eligible.filter((j) => staleSet.has(j.id));
      summary.staleRefreshed += staleJobs.length;
      if (staleJobs.length > 0) {
        // Stamped BEFORE the work, so a crash mid-batch cannot let the next tick
        // start another one immediately and undo the pacing.
        await admin
          .from("profiles")
          .update({ stale_refreshed_at: new Date().toISOString() })
          .eq("id", userId);
      }

      // Unscored first: a row with no number at all is worth more to the user
      // than a slightly out-of-date one.
      const backlog = [...unscored, ...staleJobs];

      if (backlog.length > 0) {
        // The split (issue #96): a brand-new user gets SYNC_ONBOARDING_SLICE roles
        // at full price so their screen fills immediately; the long tail goes to
        // batch at half price. Returning users have nobody watching — all batch.
        const { sync: syncSlice, batched } = batchAvailable
          ? partitionOnboarding(backlog, isFirstPass, SYNC_ONBOARDING_SLICE)
          : { sync: backlog, batched: [] };

        // ── Phase 3: submit the tail. One batch per tick keeps the retrieval hop
        // and the upsert pass bounded; the remainder is picked up next tick. ────
        if (batched.length > 0) {
          const { head } = chunkForBatch(batched);
          const { data: jdRows, error: jdErr } = await admin
            .from("jobs")
            .select("id, jd_text")
            .in("id", head.map((j) => j.id));
          if (jdErr) throw new Error(`jd_text read failed: ${jdErr.message}`);
          const jdById = new Map((jdRows ?? []).map((r) => [r.id, r.jd_text as string | null]));
          const requests = buildBatchRequests(
            head.map((j) => ({
              id: j.id,
              // Byte-identical to the synchronous path's prompt — same rubric
              // (incl. the row's role-family fit block, #34), same shaping, same
              // grounding facts. Only the transport differs.
              system: buildScoreSystem(j.role_family),
              userMessage: buildScoreUserMessage(profile, {
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
            })),
            { model: HAIKU, maxTokens: SCORE_MAX_TOKENS, system: buildScoreSystem(null) },
          );
          const submitted = await proxyBatchOp(proxyUrl, serviceKey, { op: "batch_submit", requests });
          const providerBatchId = submitted?.id;
          if (typeof providerBatchId === "string") {
            // Record BEFORE anything else can fail: an unrecorded batch is paid-for
            // work nothing will ever retrieve.
            const { error: insErr } = await admin.from("score_batches").insert({
              user_id: userId,
              provider_batch_id: providerBatchId,
              worker: "backlog",
              rubric_version: RUBRIC_VERSION,
              job_ids: head.map((j) => j.id),
            });
            if (insErr) console.warn(`[score-backlog] score_batches insert failed for ${providerBatchId}:`, insErr.message);
            else summary.submitted += head.length;
          }
        }

        // Score in jd-batches: fetch jd_text for ≤JD_BATCH rows, pool-score them,
        // upsert as each lands (a crash loses only in-flight calls). Failed calls
        // (parse/network) are NOT upserted, so the next tick retries them naturally.
        for (let i = 0; i < syncSlice.length && Date.now() < deadlineMs; i += JD_BATCH) {
          const batch = syncSlice.slice(i, i + JD_BATCH);
          const { data: jdRows, error: jdErr } = await admin
            .from("jobs")
            .select("id, jd_text")
            .in("id", batch.map((j) => j.id));
          if (jdErr) throw new Error(`jd_text read failed: ${jdErr.message}`);
          const jdById = new Map((jdRows ?? []).map((r) => [r.id, r.jd_text as string | null]));

          const { deadlineHit } = await runPool(batch, SCORE_CONCURRENCY, deadlineMs, async (j) => {
            const jdText = jdById.get(j.id) ?? null;
            const result = await scoreViaProxy(
              proxyUrl,
              serviceKey,
              userId,
              buildScoreSystem(j.role_family), // #34: per-row role-family rubric
              buildScoreUserMessage(profile, {
                id: j.id,
                company: j.company,
                title: j.title,
                location: j.location ?? null,
                remote: Boolean(j.remote),
                seniority: j.seniority ?? null,
                jd_text: jdText,
                yoe_min: j.extraction?.yoe_min ?? null,
                geo_eligibility: j.extraction?.geo_eligibility ?? null,
              }),
              { cvText: profile.cv_text, jdText },
            );
            if (!result) {
              summary.failed++;
              return;
            }
            // Row shape shared with the nightly's write-through (#135).
            const { error: upErr } = await admin
              .from("scores")
              .upsert(toScoresRow(userId, j.id, result, cvHash), { onConflict: SCORES_ON_CONFLICT });
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
      // never a false "ready" email. Roles sitting in an OPEN batch are likewise
      // absent from scoreByJob, so the "your roles are scored" email waits for the
      // batch tail to drain rather than firing on the synchronous slice alone.
      const remaining = eligible.filter((j) => !scoreByJob.has(j.id)).length;

      if (
        eligible.length > 0 &&
        shouldSendReadyEmail(remaining, (p.scores_ready_notified_at as string | null) ?? null)
      ) {
        summary.completed++;
        if (resendKey) {
          const strong = eligible.filter(
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
              buildReadyBody(strong ?? 0, eligible.length, APP_URL, tier),
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
