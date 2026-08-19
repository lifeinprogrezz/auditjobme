// Phase B (overnight-job-hunter, spec 2026-07-07 §7) — the nightly matches loop.
// A Node serverless function (Vercel), SEPARATE from the Vite bundle (nothing under
// src/ imports this; it is never pulled into the client). It:
//   active users → new jobs since their last batch → labelled slice → score the
//   top-N via the anthropic-proxy edge fn (service-role, target_user_id) → rank →
//   upsert daily_matches (idempotent) → one Resend "N roles ready" email.
// Slice 1 = SCORING ONLY. No CV/cover/audit generation, no in-app /matches view.
//
// DURABLE EXECUTION (F6): the outer user loop is TIME-BUDGETED. A many-user night
// can't fit in one 60s function, so the loop stops starting new users once
// NIGHTLY_RUN_BUDGET_MS is spent and the repeat trigger resumes on the next tick.
// The trigger is .github/workflows/nightly.yml (every 10 min across the morning
// drain window, kicking off at 06:00 UTC — AFTER the 05:00 scrape refreshes the
// pool), NOT a Vercel daily cron: Vercel Hobby crons are daily-only and a single
// daily invocation can't drain many users. Resumption is idempotent — a user
// already scored + notified today is a "skip" (decideNightlyAction), so each tick
// picks up exactly where the last left off. Same pattern as api/score-backlog.ts.
//
// Env (from the Supabase↔Vercel integration + Rober's Vercel env):
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — Supabase server access (service role).
//   RESEND_API_KEY — transactional email. CRON_SECRET — repeat-trigger auth (the
//   GitHub Action sends it as `Authorization: Bearer <CRON_SECRET>`).
import { createClient } from "@supabase/supabase-js";
import { pickScoringSlice } from "../src/lib/labels.js";
import { buildScoreSystem, SCORE_MAX_TOKENS, buildScoreUserMessage, parseScoreResponse, RUBRIC_VERSION } from "../src/lib/scorePrompt.js";
import {
  NIGHTLY_TOP_N,
  NIGHTLY_RUN_BUDGET_MS,
  nightlyBudgetExhausted,
  cronAuthResult,
  selectNightlyCandidates,
  decideNightlyAction,
  isMissingRubricColumn,
  classifyHistoryRead,
  rankMatches,
  attachWarmCounts,
  buildEmailSubject,
  buildEmailBody,
  type NightlyJob,
  type ScoredMatch,
  type RankedMatch,
  nightlyRunVerdict,
} from "../src/lib/nightly.js";
import { fetchAllPages } from "../src/lib/pagedSelect.js";
import { companyKey } from "../src/lib/connections.js";
import { BRAND_NAME } from "../src/lib/brandName.js";
import {
  buildBatchRequests,
  isBatchStale,
  isMissingBatchTable,
  parseBatchResults,
} from "../src/lib/scoreBatch.js";

// Minimal Vercel Node handler types (avoids a @vercel/node dependency).
type Req = { method?: string; headers: Record<string, string | string[] | undefined> };
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

const APP_URL = "https://northgoing.com/";
// Only the DISPLAY NAME follows the rebrand. The address stays on
// lifeinprogrezz.com because that is the domain verified in Resend; sending from
// an unverified northgoing.com would make Resend reject every send.
const EMAIL_FROM = `${BRAND_NAME} <matches@northgoing.com>`;
const HAIKU = "claude-haiku-4-5-20251001";
const JOB_FETCH_LIMIT = 800; // recent-jobs candidate window (newest first)

const env = (k: string) => process.env[k];

/** One row per scored role, ready to upsert. `rubric_version` (F7) stamps which
 *  rubric produced the score so a version bump re-scores the batch instead of the
 *  nightly path silently serving stale scores forever. */
type MatchRow = {
  user_id: string;
  job_url: string;
  rank: number;
  score: number;
  reason: string;
  fit_bullets: string[];
  batch_date: string;
  rubric_version: string;
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

/** Call one of the proxy's service-role batch operations (issue #96, lever 2).
 *  Never throws — a batch hiccup must not halt the nightly drain. */
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
      console.warn(`[nightly] proxy ${String(body.op)} non-ok ${res.status}`);
      return null;
    }
    return (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch (e) {
    console.warn(`[nightly] proxy ${String(body.op)} failed:`, e);
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
        // Notification-sender legitimacy signal (Gmail/Yahoo bulk guidance): a valid
        // List-Unsubscribe biases the Updates tab over Promotions and keeps us out of
        // spam. mailto for now; a hosted one-click endpoint is a later slice.
        headers: {
          "List-Unsubscribe": "<mailto:hello@lifeinprogrezz.com?subject=Unsubscribe%20Northgoing%20matches>",
        },
      }),
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
  // "Jul 7"-style label for the (transactional) email subject.
  const dateLabel = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const nowMs = Date.now();

  // Send the "N roles ready" email for a persisted batch and, on send-success,
  // stamp notified_at so the same-day early-exit (B3) treats the user as done.
  // Shared by the fresh-score path and the email-retry path. Fail-soft → bool.
  // Local closure (not module-level) so it captures `admin`'s inferred client type.
  // Warm-contacts marker (issue #108, following #41 / PR #104): the user's OWN
  // connections rows, matched on the SAME companyKey() the Today/digest cards use
  // (imported, never reimplemented — the two surfaces must never disagree). ONE
  // cheap query against the (user_id, company_key) index, filtered to the email's
  // companies; a user who never uploaded a connections export gets an empty result
  // and a byte-identical email. Fail-soft: a read error drops the marker, never
  // the email. NO score or rank change — information, not a thumb on the scale.
  const withWarmCounts = async (userId: string, ranked: RankedMatch[]): Promise<RankedMatch[]> => {
    const keys = [...new Set(ranked.map((m) => companyKey(m.company)).filter(Boolean))];
    if (keys.length === 0) return ranked;
    const { data, error } = await admin
      .from("connections")
      .select("company_key")
      .eq("user_id", userId)
      .in("company_key", keys);
    if (error || !data) {
      if (error) console.warn(`[nightly] connections read failed for ${userId}: ${error.message} — sending without warm markers`);
      return ranked;
    }
    return attachWarmCounts(ranked, data.map((r) => r.company_key as string));
  };

  const sendBatchEmail = async (
    key: string,
    userId: string,
    batchDate: string,
    ranked: RankedMatch[],
  ): Promise<boolean> => {
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const to = authUser?.user?.email;
    if (!to) return false;
    const sent = await sendEmail(key, to, buildEmailSubject(ranked.length, dateLabel), buildEmailBody(await withWarmCounts(userId, ranked), APP_URL));
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
  // A CV is the only real requirement. Labels used to be required too, but the #70
  // vocabulary migration rewrites an all-unmappable stored array to '{}', so a
  // user whose every old label retired would have silently stopped receiving the
  // digest — no error, no notice, just no more mail. Empty labels already mean
  // "no preference" everywhere else (prefilterWithTier's newest tier, and
  // pickScoringSlice's early return), so they must not mean "not a user" here.
  const active = (profiles ?? []).filter(
    (p) => typeof p.cv_text === "string" && p.cv_text.trim().length > 0,
  );

  // ── Candidate jobs (newest first) + company→sector for the label slice ────
  const { data: jobRows, error: jErr } = await admin
    .from("jobs")
    .select("id, company, company_id, title, url, location, remote, seniority, jd_text, extraction, role_family, first_seen_at, posted_at")
    .eq("is_live", true)
    .order("first_seen_at", { ascending: false })
    .limit(JOB_FETCH_LIMIT);
  if (jErr) {
    res.status(500).json({ error: `jobs read failed: ${jErr.message}` });
    return;
  }
  // Paged, and the error is read. This was an un-ranged select whose error was
  // discarded: past 1000 companies the sector map silently loses entries and the
  // digest labels those roles null, with nothing in the logs to say why.
  const cos = await fetchAllPages<{ slug: string; sector: string | null }>(
    () => admin.from("companies").select("slug, sector"),
    { label: "companies:nightly" },
  );
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
    yoe_min: (r.extraction as { yoe_min?: number | null } | null)?.yoe_min ?? null,
    geo_eligibility: (r.extraction as { geo_eligibility?: string | null } | null)?.geo_eligibility ?? null,
    role_family: r.role_family ?? null,
    sector: r.company_id ? (sectorBySlug.get(r.company_id) ?? null) : null,
    first_seen_at: r.first_seen_at,
    posted_at: r.posted_at,
  }));
  // url → {company,title,location} for rebuilding the email preview on the
  // retry-email path (daily_matches stores only job_url, not the display fields).
  // Location joined the set with the per-role email rows (issue #72 slice 3).
  const jobByUrl = new Map(
    jobs.map((j) => [j.url, { company: j.company, title: j.title, location: j.location ?? null }]),
  );

  const summary = {
    users: active.length,
    processed: 0,
    skipped: 0,
    emailed: 0,
    capped: 0,
    matches: 0,
    submitted: 0,
    inFlight: 0,
    deadlineHit: false,
    batchAvailable: true,
    failed: 0,
  };

  // Issue #96 lever 2: the nightly slice is scored through the Message Batches API
  // (a flat 50% discount) because nobody is waiting on it — the deliverable is one
  // email, not a live screen. Submission and retrieval land on DIFFERENT ticks of
  // the 06:00–09:50 UTC drain window; migration 20260726103000 holds the in-flight
  // state between them. Until that migration is applied, this flips off and every
  // user falls back to the previous synchronous pass.
  let batchAvailable = true;

  // F6 durable execution: budget the user loop. When time runs out we exit cleanly
  // (in-flight user already finished — the check is between users) and the next
  // repeat-trigger tick resumes; done users skip, so no work is redone or lost.
  const startedMs = Date.now();
  for (const p of active) {
    if (nightlyBudgetExhausted(startedMs, Date.now(), NIGHTLY_RUN_BUDGET_MS)) {
      summary.deadlineHit = true;
      break;
    }
    const userId = p.id as string;
    try {
      // Every prior daily_matches row for this user (small: ≤ NIGHTLY_TOP_N per
      // night). Drives three decisions: today's batch state (B3 notified-split),
      // the created_at cutoff (B2), and the already-matched-URL exclusion (B2).
      let sel = await admin
        // paging-ok: one user, one batch_date, capped at NIGHTLY_TOP_N (10) rows.
        .from("daily_matches")
        .select("job_url, rank, score, reason, fit_bullets, batch_date, created_at, notified_at, rubric_version")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      // Pre-F7 schema (migration 20260712123000 not yet applied): the column is
      // missing, so the select errors and data comes back null — which would empty
      // seenUrls and re-notify previously seen roles. Fall back to the pre-F7
      // column set; rows then read rubric_version=undefined → "stale" → a bounded
      // once-daily rescore until the migration lands. Loud on purpose.
      if (classifyHistoryRead(sel.error) === "fallback") {
        console.warn("[nightly] daily_matches.rubric_version missing — pre-F7 schema; apply migration 20260712123000. Falling back.");
        // Cast: fallback rows genuinely lack rubric_version; downstream reads treat
        // it as optional (undefined = stale rubric), which is the intended degrade.
        sel = (await admin
          // paging-ok: one user, one batch_date, capped at NIGHTLY_TOP_N (10) rows.
          .from("daily_matches")
          .select("job_url, rank, score, reason, fit_bullets, batch_date, created_at, notified_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })) as typeof sel;
      }
      // #54 general sel.error guard: ANY residual read error here — a non-column
      // error on the first select, or a failure of the fallback select itself —
      // leaves sel.data null → empty seenUrls → we'd re-notify roles this user has
      // already seen. Skip the user (loud) rather than proceed on empty history.
      if (sel.error) {
        console.warn(
          `[nightly] daily_matches history read failed for ${userId} (${sel.error.code ?? "?"}: ${sel.error.message}) — skipping to protect exactly-once notifications`,
        );
        summary.skipped++;
        continue;
      }
      const rowsForUser = sel.data ?? [];

      // ── Batch phase 1: retrieve anything already in flight for this user ────
      // Runs BEFORE the action decision because a retrieval writes today's rows,
      // which is exactly what decideNightlyAction reads. Either outcome ends this
      // user's tick: retrieved (batch persisted + emailed) or still processing.
      if (batchAvailable) {
        const { data: openBatches, error: obErr } = await admin
          .from("score_batches")
          .select("id, provider_batch_id, job_ids, rubric_version, batch_date")
          .eq("user_id", userId)
          .eq("worker", "nightly")
          .eq("status", "submitted");
        if (obErr && isMissingBatchTable(obErr)) {
          console.warn("[nightly] score_batches missing — apply migration 20260726103000. Falling back to synchronous scoring.");
          batchAvailable = false;
          summary.batchAvailable = false;
        } else if (obErr) {
          console.warn(`[nightly] score_batches read failed for ${userId}: ${obErr.message} — skipping to protect exactly-once notifications`);
          summary.skipped++;
          continue;
        }
        const open = (openBatches ?? [])[0];
        if (open) {
          if (isBatchStale(String(open.rubric_version), RUBRIC_VERSION)) {
            // Rubric moved on: the judgments about to come back are no longer the
            // product's. Retire the row; the flow below re-submits under the new one.
            await admin
              .from("score_batches")
              .update({ status: "failed", retrieved_at: new Date().toISOString() })
              .eq("id", open.id);
          } else {
            const res = await proxyBatchOp(proxyUrl, serviceKey, {
              op: "batch_results",
              batch_id: open.provider_batch_id,
              target_user_id: userId,
              kind: "score",
            });
            const jsonl = res?.jsonl;
            if (typeof jsonl !== "string") {
              summary.inFlight++; // still processing — a later tick picks it up
              continue;
            }
            const jobById = new Map(jobs.map((j) => [j.id, j]));
            const batchDate = (open.batch_date as string | null) ?? today;
            const scored: ScoredMatch[] = [];
            for (const r of parseBatchResults(jsonl)) {
              if (r.kind !== "succeeded") continue;
              const j = jobById.get(r.customId);
              if (!j) continue; // role went dead between submit and retrieve
              // Same validator as the synchronous path, sources omitted exactly as
              // scoreViaProxy omits them — a batch result is the same model output.
              const parsed = parseScoreResponse(r.text);
              if (!parsed) {
                console.warn("[nightly] unparseable batch score — skipping job");
                continue;
              }
              scored.push({
                url: j.url,
                company: j.company,
                title: j.title,
                location: j.location ?? null,
                score: parsed.score,
                reason: parsed.reason,
                fitBullets: parsed.fitBullets,
              });
            }
            await admin
              .from("score_batches")
              .update({ status: "retrieved", retrieved_at: new Date().toISOString() })
              .eq("id", open.id);
            summary.processed++;
            if (scored.length === 0) continue;

            // An F7 rescore of an already-notified day keeps its ONE email: the
            // upsert preserves notified_at, so re-check before sending.
            const priorToday = rowsForUser.filter((r) => r.batch_date === batchDate);
            const alreadyNotified = priorToday.some((r) => r.notified_at != null);
            const ranked = rankMatches(scored);
            const rows: MatchRow[] = ranked.map((m) => ({
              user_id: userId,
              job_url: m.url,
              rank: m.rank,
              score: m.score,
              reason: m.reason,
              fit_bullets: m.fitBullets,
              batch_date: batchDate,
              rubric_version: RUBRIC_VERSION,
            }));
            let { error: upErr } = await admin
              .from("daily_matches")
              .upsert(rows, { onConflict: "user_id,job_url,batch_date" });
            if (upErr && isMissingRubricColumn(upErr)) {
              console.warn("[nightly] daily_matches.rubric_version missing — retrying batch upsert without the rubric stamp.");
              ({ error: upErr } = await admin
                .from("daily_matches")
                .upsert(rows.map(({ rubric_version: _rv, ...rest }) => rest), { onConflict: "user_id,job_url,batch_date" }));
            }
            if (upErr) {
              console.warn(`[nightly] batch upsert failed for ${userId}:`, upErr.message);
              continue;
            }
            summary.matches += rows.length;
            if (resendKey && !alreadyNotified && (await sendBatchEmail(resendKey, userId, batchDate, ranked))) {
              summary.emailed++;
            }
            continue;
          }
        }
      }

      const todaysRows = rowsForUser.filter((r) => r.batch_date === today);
      const action = decideNightlyAction(todaysRows, RUBRIC_VERSION);

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
                location: meta?.location ?? null,
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

      // action === "score" or "rescore": run the full scoring pass.
      // "New since last batch": the most recent PRIOR batch's created_at (a real
      // timestamptz — NOT batch_date, whose 00:00-UTC parse would re-select every
      // job first seen in the 00:00–06:00 window each night). No prior row → the
      // ~24h fallback window. seenUrls = every URL already matched, ever, so a
      // cutoff regression or schedule change can never re-notify a seen role.
      //
      // F7 rescore (rubric bumped): exclude today's now-stale batch from the cutoff
      // AND the seen set, so today's own jobs re-score under the new rubric and the
      // upsert overwrites the stale rows (rubric_version stamped current). A user
      // already notified today keeps their ONE email — the upsert preserves
      // notified_at, so we simply don't send a second (alreadyNotifiedToday below).
      const isRescore = action === "rescore";
      const priorRows = isRescore ? rowsForUser.filter((r) => r.batch_date !== today) : rowsForUser;
      const alreadyNotifiedToday = isRescore && todaysRows.some((r) => r.notified_at != null);
      const sinceIso = (priorRows[0]?.created_at as string | null) ?? null;
      const seenUrls = new Set(priorRows.map((r) => r.job_url as string));

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

      // ── Batch phase 2: submit, don't score. Nobody is waiting on the nightly
      // slice — the deliverable is one email — so it goes to the discounted batch
      // path and a later tick in the drain window retrieves, ranks, and sends. ──
      if (batchAvailable) {
        const requests = buildBatchRequests(
          candidates.map((j) => ({
            id: j.id,
            // Byte-identical to the synchronous prompt below: same rubric (incl.
            // the row's role-family fit block, #34), same shaping, same grounding
            // facts. Only the transport differs.
            system: buildScoreSystem(j.role_family),
            userMessage: buildScoreUserMessage(profile, {
              id: j.id,
              company: j.company,
              title: j.title,
              location: j.location ?? null,
              remote: Boolean(j.remote),
              seniority: j.seniority ?? null,
              jd_text: j.jd_text ?? null,
              yoe_min: j.yoe_min ?? null,
              geo_eligibility: j.geo_eligibility ?? null,
            }),
          })),
          { model: HAIKU, maxTokens: SCORE_MAX_TOKENS, system: buildScoreSystem(null) },
        );
        const submitted = await proxyBatchOp(proxyUrl, serviceKey, { op: "batch_submit", requests });
        const providerBatchId = submitted?.id;
        if (typeof providerBatchId === "string") {
          // Record BEFORE anything else can fail: an unrecorded batch is paid-for
          // work that nothing will ever retrieve.
          const { error: insErr } = await admin.from("score_batches").insert({
            user_id: userId,
            provider_batch_id: providerBatchId,
            worker: "nightly",
            rubric_version: RUBRIC_VERSION,
            job_ids: candidates.map((j) => j.id),
            batch_date: today,
          });
          if (insErr) console.warn(`[nightly] score_batches insert failed for ${providerBatchId}:`, insErr.message);
          else summary.submitted += candidates.length;
        }
        continue;
      }

      // Score the (≤ NIGHTLY_TOP_N) candidates CONCURRENTLY. Sequential scoring of a
      // full slice against a real multi-KB CV exceeds Vercel's 60s function cap, and
      // the upsert runs only AFTER the loop — so a timeout there loses the whole batch
      // (0 rows persisted despite paid-for scores; the 504 we just hit). Parallel keeps
      // wall-time ≈ one call. scoreViaProxy never throws, so Promise.all can't reject.
      const results = await Promise.all(
        candidates.map((j) =>
          scoreViaProxy(
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
              jd_text: j.jd_text ?? null,
              yoe_min: j.yoe_min ?? null,
              geo_eligibility: j.geo_eligibility ?? null,
            }),
          ).then((r) => ({ j, r })),
        ),
      );
      const scored: ScoredMatch[] = [];
      for (const { j, r } of results) {
        if (r.kind === "capped") {
          summary.capped++;
          continue;
        }
        if (r.kind !== "ok") continue;
        scored.push({
          url: j.url,
          company: j.company,
          title: j.title,
          location: j.location ?? null,
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
        rubric_version: RUBRIC_VERSION,
      }));
      let { error: upErr } = await admin
        .from("daily_matches")
        .upsert(rows, { onConflict: "user_id,job_url,batch_date" });
      // Pre-F7 schema: PostgREST rejects the whole row set over the unknown
      // column. Retry once without the stamp rather than losing the day's batch.
      if (upErr && isMissingRubricColumn(upErr)) {
        console.warn("[nightly] daily_matches.rubric_version missing — retrying upsert without the rubric stamp.");
        ({ error: upErr } = await admin
          .from("daily_matches")
          .upsert(rows.map(({ rubric_version: _rv, ...rest }) => rest), { onConflict: "user_id,job_url,batch_date" }));
      }
      if (upErr) {
        console.warn(`[nightly] upsert failed for ${userId}:`, upErr.message);
        continue;
      }
      summary.matches += rows.length;

      // ── Email (fail-soft). Only when we actually persisted ≥1 match. On a soft
      // send failure notified_at stays NULL, so a same-day re-run retries the send
      // (B3) rather than skipping the user forever. On an F7 rescore of an
      // already-notified batch we DON'T send a second email — the upsert preserved
      // notified_at, so the once-a-day guarantee holds. ─────────────────────────
      if (resendKey && !alreadyNotifiedToday && (await sendBatchEmail(resendKey, userId, today, ranked))) {
        summary.emailed++;
      }
    } catch (e) {
      // Counted, not just logged: a run where EVERY user lands here is an outage,
      // and the verdict below turns that into a non-200 so the Action goes red.
      summary.failed++;
      console.warn(`[nightly] user ${userId} failed:`, e);
    }
  }

  // A run that failed for every user used to answer 200 {ok:true}, so the scheduled
  // Action went green through a total outage. Zero matches is still a fine night;
  // zero SURVIVING users is not. See nightlyRunVerdict + its tests.
  const verdict = nightlyRunVerdict({ users: summary.users, processed: summary.processed, failed: summary.failed });
  if (!verdict.ok) console.error(`[nightly] ${verdict.reason}`);
  res.status(verdict.status).json({ ok: verdict.ok, date: today, ...summary, ...(verdict.reason ? { reason: verdict.reason } : {}) });
}
