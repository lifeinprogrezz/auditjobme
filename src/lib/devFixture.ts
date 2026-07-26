// Dev-only verification fixture (NOT a product surface).
//
// `VITE_E2E_BYPASS_AUTH=1` already lets an automated walk past RequireAuth, but the
// mock user carries no JWT, so every own-row query comes back empty and /today
// renders its "add your CV" empty state. Three checklist surfaces then have no live
// coverage at all: the New-today section (daily_matches), the dismiss control, and
// the cap-1 "+N more from {company}" affordance. The 2026-07-26 verification pass
// reported exactly that gap.
//
// So under the SAME double gate, this module supplies obviously-synthetic scores and
// a synthetic nightly batch over the REAL public job pool, and the dismiss write is
// kept local. `import.meta.env.DEV` is a literal false in a production `vite build`,
// so the gate folds and every helper below tree-shakes out of the shipped bundle.
// Nothing here touches the database, and RLS remains the only real enforcement.
import { AUTH_BYPASSED } from "@/components/AuthProvider";
import type { DailyMatchRow } from "@/lib/product";
import type { ScoreableProfile } from "@/lib/score";

/** Single gate, borrowed from AuthProvider so the two can never drift. */
export const DEV_FIXTURE = AUTH_BYPASSED;

/** Said out loud on every fixture row so no walk mistakes this for real scoring. */
export const DEV_FIXTURE_REASON =
  "Dev fixture: a synthetic score for UI verification, not a real match.";

/** A CV on file is what flips /today out of its empty state (`scored`). */
export const DEV_FIXTURE_PROFILE: ScoreableProfile = {
  target_seniority: "senior",
  target_cities: ["London", "Berlin", "Barcelona", "Amsterdam", "Stockholm"],
  open_to_remote: true,
  citizenship: "ES",
  eu_work_authorized: true,
  languages: ["English", "Spanish"],
  cv_text: "Dev fixture CV. Product Manager, Europe. Used only by the E2E auth bypass.",
};

/** Deterministic 4.0–9.5 from the job id (FNV-1a): the same walk twice ranks the
 *  same way, so a screenshot diff means a real change, not a reshuffle. */
export function devFixtureScore(jobId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < jobId.length; i++) {
    h ^= jobId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return Math.round((4 + (h % 5501) / 1000) * 10) / 10;
}

/** Fill ONLY the unscored rows, so a real signed-in score always wins. */
export function devFixtureScores<T extends { id: string; score: number | null; reason: string | null }>(
  jobs: T[],
): T[] {
  return jobs.map((j) =>
    j.score == null ? { ...j, score: devFixtureScore(j.id), reason: DEV_FIXTURE_REASON } : j,
  );
}

/** A nightly batch over the best fixture-scored roles, dated today so the section
 *  renders its "New today" heading — the exact shape useDailyMatches returns. */
export function devFixtureBatch(
  jobs: { id: string; url: string; score: number | null }[],
  batchDate: string,
  rubricVersion: string,
  topN = 8,
): DailyMatchRow[] {
  return [...jobs]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, topN)
    .map((j, i) => ({
      job_url: j.url,
      batch_date: batchDate,
      rank: i + 1,
      seen_at: null,
      score: j.score,
      reason: DEV_FIXTURE_REASON,
      rubric_version: rubricVersion,
    }));
}
