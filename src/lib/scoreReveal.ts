// Holding the CV screen until the first roles are really scored (Rober, walking
// the product 2026-08-28): "hold the user the first seconds in the deposit cv
// screen before drop it into the map, only open him the map till we have the first
// 14 / batch of jobs scored."
//
// Before this, saving a CV revealed the map immediately and the scores trickled in
// behind it, so the first thing a new user saw was their own map with nothing on
// it. The wait is the same either way; this only decides whether they spend it
// looking at an empty map or at a progress line that says what is happening.
//
// THE NUMBERS ARE MEASURED, not guessed. From the 2026-08-26 signup: 15 roles
// scored inside the first minute, all 40 of the synchronous slice by the second
// (14:51 -> 15 rows, 14:52 -> 40 rows). So 15 is about a minute of waiting, and a
// cap has to sit ABOVE that or it fires first and the gate never holds — the 45s
// first considered would have released early nearly every time.
//
// Pure and client-import-free, so the hook and the tests share one source.

/** Roles that must carry a score before the map opens. ~60s at measured rates. */
export const REVEAL_MIN_SCORES = 15;

/**
 * The hard release. Scoring can be slow, rate-limited, or down; whatever happens,
 * nobody is held longer than this. Sits above the measured ~60s so the normal case
 * is released by real scores rather than by the timer.
 */
export const REVEAL_CAP_MS = 90_000;

/**
 * May the map open yet? True once enough roles carry a score, or once the cap has
 * passed. Fails OPEN on purpose: a stall costs a plainer first view, never a person
 * stuck on a screen with no way forward.
 */
export function shouldReveal(
  scoredCount: number,
  elapsedMs: number,
  need: number = REVEAL_MIN_SCORES,
  capMs: number = REVEAL_CAP_MS,
): boolean {
  return scoredCount >= need || elapsedMs >= capMs;
}

/** "11 of 15" for the waiting line. Never reports more than it needs, so the
 *  count cannot read "23 of 15" once a fast batch overshoots. */
export function revealProgressLabel(scoredCount: number, need: number = REVEAL_MIN_SCORES): string {
  return `${Math.min(Math.max(scoredCount, 0), need)} of ${need}`;
}
