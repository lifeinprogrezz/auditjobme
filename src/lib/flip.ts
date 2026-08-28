// FLIP planning — the pure half of useFlip (src/hooks/useFlip.ts).
//
// The roles list is score-sorted, so a role that gains a score re-ranks, and it
// used to teleport to its new slot. Rober, 2026-08-28: "when you click manually
// on the score the role and its scored it jumps to the top of the list on the
// right menu, can you make that jump smoother?" FLIP is the standard answer:
// remember where each element WAS (First), let the DOM lay it out where it IS
// (Last), then play the difference (Invert, Play) as a transform, so the browser
// animates from the old position to the new one instead of cutting.
//
// This file only decides WHAT moves and by how much. The hook measures and plays.
// Pinned by src/test/flip.test.ts.

export type FlipMove = { key: string; dy: number };

/** Ignore sub-pixel jitter: a move smaller than this is layout noise, not a rank
 *  change, and animating it would make a still list shimmer. */
export const FLIP_MIN_PX = 1;

/**
 * Which keys moved, and by how much, between two layouts. A key present only in
 * `next` is new (it fades in with the list, nothing to glide from); a key present
 * only in `prev` is gone (nothing left to move). With `reduceMotion` nothing moves
 * at all — the user asked for that at the OS level and the cut is the intent.
 */
export function planFlip(
  prev: ReadonlyMap<string, number>,
  next: ReadonlyMap<string, number>,
  reduceMotion: boolean,
): FlipMove[] {
  if (reduceMotion) return [];
  const moves: FlipMove[] = [];
  for (const [key, top] of next) {
    const was = prev.get(key);
    if (was == null) continue;
    const dy = was - top;
    if (Math.abs(dy) >= FLIP_MIN_PX) moves.push({ key, dy });
  }
  return moves;
}
