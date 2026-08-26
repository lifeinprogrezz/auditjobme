// Scoring progress (issue #149, spec items A7 + C2) — the pure phase decision.
//
// What the rail and the Today tab used to say was "N to go", an 11px number with
// no bar, no phase and no end in sight. Worse, the number could not reach zero
// (item A8) and the worker behind it ran about once an hour (item A7), so the
// one honest thing on screen was also wrong.
//
// This module is the ONE place that turns four measured facts into what the user
// reads. Every string here comes from data we hold: the size of the paid slice,
// how much of it has landed, whether a batch is still open, and how long it has
// been since the last score arrived. Nothing is estimated unless the estimate is
// measured, and an estimate that is not yet grounded renders as nothing at all.
//
// Rendered by src/components/roles/ScoringProgress.tsx in both surfaces.
// Pinned by src/test/scoring-progress.test.ts.

/** Waiting on a batch rather than on the synchronous slice: no score has landed
 *  for this long and the user still has an open score_batches row. Three poll
 *  cycles (SCORE_POLL_MS is 20 s), so one slow call cannot flip the copy. */
export const COLLECTING_QUIET_MS = 60_000;

/** How long "All N scored" stays on screen before the component hides itself. */
export const DONE_VISIBLE_MS = 3_000;

/** An estimate needs a measured rate: this many scores landed in front of the
 *  user, over at least this long. Below either, there is no honest number. */
export const ETA_MIN_LANDED = 8;
export const ETA_MIN_ELAPSED_MS = 20_000;
/** Past this, the estimate says more about the batch queue than about the work
 *  left, so we say nothing instead of a number nobody should plan around. */
export const ETA_MAX_MS = 45 * 60_000;

export type ScoringPhase = "reading-cv" | "scoring" | "collecting" | "done";

export type ScoringProgressInput = {
  /** The user has a CV on file. Without one nothing is being scored. */
  hasCv: boolean;
  /** The map data and the profile have settled, so `total` is a real answer and
   *  not "we have not looked yet". This is the whole difference between "Reading
   *  your CV" and "your targets match nothing in the catalog". */
  ready: boolean;
  /** Roles in the paid slice (the #114 prefilter), as the client counts them. */
  total: number;
  /** Roles in that slice that already hold a score. */
  scored: number;
  /** The user has a score_batches row still in `submitted` — work bought and
   *  waiting on the provider, which gives no latency guarantee. */
  batchPending: boolean;
  /** Milliseconds since the last score landed in this session. */
  sinceLastScoreMs: number;
};

export type ScoringProgressView = {
  phase: ScoringPhase;
  total: number;
  scored: number;
  /** 0 to 1. Zero while the slice size is still unknown. */
  fraction: number;
  headline: string;
  /** The honest count beside the headline, or null when there is nothing to count. */
  detail: string | null;
};

/** Which phase the four facts describe, or null when nothing should render. */
export function scoringPhaseOf(input: ScoringProgressInput): ScoringPhase | null {
  if (!input.hasCv) return null;
  // The slice is computed from the map data and the saved targets, so before both
  // have settled a zero means "we have not looked yet".
  if (!input.ready) return "reading-cv";
  // Settled AND empty is the #114 empty-slice case: the labels match nothing in
  // the catalog, so nothing is being scored and a progress bar would be a lie.
  // The "Not scored" copy on those rows points at Settings instead.
  if (input.total <= 0) return null;
  if (input.scored >= input.total) return "done";
  if (input.batchPending && input.sinceLastScoreMs >= COLLECTING_QUIET_MS) return "collecting";
  return "scoring";
}

/** The phase plus the copy and the bar fraction that go with it. */
export function scoringProgressOf(input: ScoringProgressInput): ScoringProgressView | null {
  const phase = scoringPhaseOf(input);
  if (phase === null) return null;
  const total = Math.max(0, input.total);
  const scored = Math.min(Math.max(0, input.scored), total);
  const fraction = total > 0 ? scored / total : 0;
  const counted = `${scored} of ${total} done`;
  if (phase === "reading-cv") {
    return { phase, total, scored, fraction, headline: "Reading your CV", detail: null };
  }
  if (phase === "done") {
    return { phase, total, scored, fraction: 1, headline: `All ${total} scored`, detail: null };
  }
  if (phase === "collecting") {
    return { phase, total, scored, fraction, headline: "Collecting the rest", detail: counted };
  }
  return { phase, total, scored, fraction, headline: `Scoring ${total} roles`, detail: `${scored} done` };
}

/**
 * Milliseconds left at the pace we have actually watched, or null when we have
 * not watched enough to say. `landed` and `elapsedMs` are measured in front of
 * the user since the component mounted, so a page opened halfway through a pass
 * projects from its own session rather than from a rate it never saw.
 */
export function estimateRemainingMs(args: {
  landed: number;
  elapsedMs: number;
  remaining: number;
}): number | null {
  const { landed, elapsedMs, remaining } = args;
  if (remaining <= 0) return null;
  if (landed < ETA_MIN_LANDED || elapsedMs < ETA_MIN_ELAPSED_MS) return null;
  const perMs = landed / elapsedMs;
  if (!Number.isFinite(perMs) || perMs <= 0) return null;
  const estimate = remaining / perMs;
  if (!Number.isFinite(estimate) || estimate > ETA_MAX_MS) return null;
  return Math.round(estimate);
}

/** The estimate as one short phrase. Minutes only: seconds would imply a
 *  precision the measurement does not have. */
export function formatRemaining(ms: number): string {
  if (ms < 60_000) return "less than a minute left";
  const minutes = Math.round(ms / 60_000);
  return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"} left`;
}
