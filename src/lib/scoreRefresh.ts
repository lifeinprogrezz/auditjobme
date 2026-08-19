// CV-churn cost control (#123). Pure logic, shared by the backlog worker and
// its tests; no client imports, like scoreBacklog.ts.
//
// THE PROBLEM, measured 2026-08-19. A CV edit used to run
// `delete from scores where user_id = ...` and the worker re-bought the user's
// entire slice at ~$3.69. Seven edits in a month therefore cost about 13x that
// user's ordinary spend, and editing a CV is the core loop of an active job
// seeker rather than an edge case — so engagement and cost were perfectly
// correlated, which is backwards. It was also a user-visible bug: the map went
// blank after every edit until the worker drained.
//
// THE SHAPE OF THE FIX. Scores are kept and marked against the CV they were
// computed from, so an edit leaves the user looking at real numbers instead of
// an empty page, and the worker gets to CHOOSE what to re-buy rather than being
// forced to buy everything:
//   1. keep, never delete  — a stale score still tells the user something
//   2. best roles first    — refresh what they actually look at, immediately
//   3. pace the long tail  — a fixed budget per pass, not one big purchase
//   4. wait for quiet      — eight edits in one sitting cost one refresh
//
// The same machinery covers the other step function: a RUBRIC_VERSION bump also
// invalidates everything for everyone on one day (~$370 at 100 users), and it
// drains through the same paced path.
// Spec: planning repo docs/specs/2026-07-26-economics-decisions.md §2.

/** How long edits must go quiet before a refresh starts. Saves during a single
 *  editing session collapse into one pass. */
export const STALE_DEBOUNCE_MS = 5 * 60 * 1000;

/** Stale scores re-bought per user per pass. The pacing dial: at ~$0.0025 a
 *  score this is a few cents per pass, and the tail catches up across passes
 *  instead of arriving as one bill. Not a user-facing cap — nobody is refused
 *  anything, the freshest and most useful rows simply go first. */
export const STALE_REFRESH_BUDGET = 40;

/**
 * Minimum gap between refresh batches for one user.
 *
 * The budget above is NOT pacing on its own: the worker fires every 10 minutes,
 * so a 40-per-pass budget with no interval would refresh 5,760 roles a day and
 * buy the entire tail within hours, which is exactly what this is meant to
 * prevent. Four batches a day, 40 roles each, is ~160 roles or ~$0.39 per user
 * per day at the very most, and only for a user who actually changed their CV.
 */
export const STALE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** May this user have a refresh batch now? */
export function shouldRefreshStale(
  lastRefreshedAt: string | null | undefined,
  nowMs: number,
  intervalMs: number = STALE_REFRESH_INTERVAL_MS,
): boolean {
  if (!lastRefreshedAt) return true;
  const t = Date.parse(lastRefreshedAt);
  // An unparseable stamp must not block refreshes forever.
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= intervalMs;
}

/** The shape the worker reads out of `scores`. */
export type ScoredRow = { job_id: string; score: number | null; cv_hash: string | null };

/**
 * Was this score computed from a different CV than the one on file?
 *
 * A row with NO recorded cv_hash counts as FRESH. Those predate this feature,
 * and calling them stale would re-buy every score every existing user already
 * holds — precisely the bill this exists to avoid.
 */
export function isStale(row: Pick<ScoredRow, "cv_hash">, currentCvHash: string | null | undefined): boolean {
  if (!row.cv_hash) return false;
  if (!currentCvHash) return false;
  return row.cv_hash !== currentCvHash;
}

/** True while the user may still be editing, so the refresh should wait. */
export function isDebounced(
  cvChangedAt: string | null | undefined,
  nowMs: number,
  windowMs: number = STALE_DEBOUNCE_MS,
): boolean {
  if (!cvChangedAt) return false;
  const t = Date.parse(cvChangedAt);
  // An unparseable timestamp must not hold a user's refresh forever.
  if (!Number.isFinite(t)) return false;
  return nowMs - t < windowMs;
}

/**
 * Which stale scores to re-buy in this pass: the highest previous scores first,
 * capped at `budget`.
 *
 * Highest-first because that is what the user reads. Their top matches refresh
 * while they are still looking at the page; a role that scored 1.2 against the
 * previous CV can wait, and if they never come back it is never bought at all.
 *
 * Ties break on job_id so two runs over the same data choose the same rows —
 * the worker and any other reader must not disagree about what is pending.
 */
export function selectStaleRefresh(
  scored: ScoredRow[],
  currentCvHash: string | null | undefined,
  budget: number = STALE_REFRESH_BUDGET,
): string[] {
  return scored
    .filter((r) => r.score != null && isStale(r, currentCvHash))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.job_id < b.job_id ? -1 : a.job_id > b.job_id ? 1 : 0))
    .slice(0, Math.max(0, budget))
    .map((r) => r.job_id);
}
