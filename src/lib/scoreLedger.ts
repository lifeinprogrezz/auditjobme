// The ONE scoring ledger shared by api/nightly.ts and api/score-backlog.ts (#135).
//
// `scores` is the record of what has been bought. The backlog worker always wrote
// to it; the nightly wrote only to daily_matches, so the two workers could not see
// each other's purchases and the same role was paid for twice. Both workers now
// write the row shape built here, and the nightly asks this module which of its
// candidates already hold a usable row before it calls the model.
//
// Reuse semantics (match #123's CV-churn rules in scoreRefresh.ts):
//   - the caller reads rows at the CURRENT RUBRIC_VERSION only, so a stale-rubric
//     row never reaches this function and is never reused;
//   - a row scored from a DIFFERENT CV (isStale) is bought again — the nightly's
//     write-through then refreshes that row, which is what the backlog's budgeted
//     stale-refresh would have done later anyway;
//   - a row with no recorded cv_hash predates #123 and counts as fresh;
//   - a row with no score is not a judgment and is bought again.
// Pure and client-import-free so the Vercel functions and vitest share it.
import { RUBRIC_VERSION, type ParsedScore } from "./scorePrompt.js";
import { isStale } from "./scoreRefresh.js";

/** What the nightly reads out of `scores` for its candidate ids. */
export type LedgerRow = {
  job_id: string;
  score: number | null;
  cv_hash: string | null;
  signals: { reason?: unknown; fit_bullets?: unknown } | null;
};

/** A candidate whose judgment already exists: rendered from the ledger, not bought. */
export type LedgerReuse<T> = { job: T; score: number; reason: string; fitBullets: string[] };

/** Partition candidates into rows to REUSE and jobs to BUY. Candidate order is kept. */
export function splitByLedger<T extends { id: string }>(
  candidates: T[],
  ledger: LedgerRow[],
  currentCvHash: string | null | undefined,
): { reuse: LedgerReuse<T>[]; buy: T[] } {
  const byJob = new Map(ledger.map((r) => [r.job_id, r]));
  const reuse: LedgerReuse<T>[] = [];
  const buy: T[] = [];
  for (const job of candidates) {
    const row = byJob.get(job.id);
    if (!row || row.score == null || isStale(row, currentCvHash)) {
      buy.push(job);
      continue;
    }
    const reason = typeof row.signals?.reason === "string" ? row.signals.reason : "";
    const fitBullets = Array.isArray(row.signals?.fit_bullets)
      ? row.signals.fit_bullets.filter((b): b is string => typeof b === "string")
      : [];
    reuse.push({ job, score: Number(row.score), reason, fitBullets });
  }
  return { reuse, buy };
}

/** The `scores` upsert row. Both workers build it here so the shape cannot drift.
 *  Upsert with `{ onConflict: "user_id,job_id,rubric_version" }` (SCORES_ON_CONFLICT). */
export const SCORES_ON_CONFLICT = "user_id,job_id,rubric_version";

export function toScoresRow(userId: string, jobId: string, parsed: ParsedScore, cvHash: string | null) {
  return {
    user_id: userId,
    job_id: jobId,
    score: parsed.score,
    rubric_version: RUBRIC_VERSION,
    cv_hash: cvHash, // which CV this judgment was made from (#123)
    signals: {
      reason: parsed.reason,
      fit_bullets: parsed.fitBullets,
      subscores: parsed.subscores,
      evidence: parsed.evidence,
    },
  };
}
