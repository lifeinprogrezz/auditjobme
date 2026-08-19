// Pure logic for the server-side scoring backlog worker (api/score-backlog.ts,
// issue #33) — kept client-import-free (like nightly.ts) so the Vercel function
// and vitest share it. The worker's shape: users with a CV → unscored live jobs
// (the backlog IS the trigger: new CV, CV change, and rubric bumps all manifest
// as unscored rows) → score a time-budgeted chunk through the anthropic-proxy →
// one "your roles are scored" email when the backlog hits zero.
// Spec: planning repo docs/specs/2026-07-10-server-side-scoring-backlog-design.md

/** Wall-clock budget for STARTING new score calls in one invocation. Vercel caps
 *  the function at 60s (vercel.json maxDuration); at ~3s per Haiku score a call
 *  started at 45s lands well inside the cap, and the next cron tick resumes. */
import type { PrefilterTier } from "./scorePrefilter.js";

export const RUN_BUDGET_MS = 45_000;

/** Concurrent in-flight score calls. The nightly matcher's Promise.all bursts ≤10;
 *  the backlog is ~764 calls, so a bounded pool keeps the burst polite. */
export const SCORE_CONCURRENCY = 8;

/** The backlog: live jobs with no scores row for this user at the current rubric
 *  version. scoredJobIds must already be rubric-version-filtered by the caller. */
export function selectBacklog<T extends { id: string }>(
  liveJobs: T[],
  scoredJobIds: Set<string>,
): T[] {
  return liveJobs.filter((j) => !scoredJobIds.has(j.id));
}

/**
 * Bounded worker pool with a deadline: `limit` workers pull items until the list
 * is exhausted OR `now() >= deadlineMs` (in-flight calls always finish; no new
 * ones start past the deadline). Returns how many items were processed — the
 * caller infers "backlog drained this run" from processed === items.length.
 * `fn` must not throw (mirror scoreViaProxy's never-throws contract).
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  deadlineMs: number,
  fn: (item: T) => Promise<void>,
  now: () => number = Date.now,
): Promise<{ processed: number; deadlineHit: boolean }> {
  let next = 0;
  let processed = 0;
  let deadlineHit = false;
  const worker = async () => {
    for (;;) {
      if (now() >= deadlineMs) {
        deadlineHit = true;
        return;
      }
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
      processed++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
  return { processed, deadlineHit };
}

/** Exactly-once completion email: fire only when the user's backlog is empty AND
 *  the pass hasn't been notified (profiles.scores_ready_notified_at is null —
 *  the CV-change path resets it, starting a new pass). */
export function shouldSendReadyEmail(backlogRemaining: number, notifiedAt: string | null): boolean {
  return backlogRemaining === 0 && notifiedAt == null;
}

/** Strong-match bar for the email copy — mirrors the map's green tier. */
export const STRONG_SCORE = 4;

export function buildReadySubject(strongCount: number): string {
  return strongCount > 0
    ? `Your roles are scored — ${strongCount} strong ${strongCount === 1 ? "match" : "matches"}`
    : "Your roles are scored";
}

export function buildReadyBody(
  strongCount: number,
  totalScored: number,
  appUrl: string,
  /** Which rung of the prefilter produced the slice (#114). The copy must
   *  describe what actually happened: a no-labels slice is the newest N roles,
   *  not a set of matches, and the cap means we can never claim "all". */
  tier: PrefilterTier = "targeted",
): { text: string; html: string } {
  const strongLine =
    strongCount > 0
      ? `${strongCount} of them look like strong matches for you.`
      : "None cleared the strong-match bar yet, but new roles land daily.";
  const what =
    tier === "newest"
      ? `the ${totalScored} newest roles`
      : `the ${totalScored} roles that match your targets`;
  const text = [
    `We finished scoring ${what} against your CV.`,
    strongLine,
    ``,
    `Open your map: ${appUrl}`,
  ].join("\n");
  const html = [
    `<p>We finished scoring <b>${what}</b> against your CV.</p>`,
    `<p>${strongLine}</p>`,
    `<p><a href="${appUrl}">Open your map</a></p>`,
  ].join("\n");
  return { text, html };
}
