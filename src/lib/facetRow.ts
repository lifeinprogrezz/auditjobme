// Geometry for the headbar's horizontally scrolling facet row (HeadBar + FilterChip).
// Pure on purpose: the overflow affordance and the portaled dropdown's viewport
// clamp are pinned by facet-row.test.ts instead of only by a live browser walk —
// the two rules that broke in the 2026-07-26 UI verification lived in untested
// inline handlers.

/** How far one arrow press pans the row — a little under one chip pair, so a press
 *  always reveals something new without teleporting past the chip you were reading. */
export const FACET_SCROLL_STEP = 220;

/** .fdrop-multi's min-width in roles.css — rule + code move together. */
export const FACET_DROP_WIDTH = 238;

/** Breathing room kept between the dropdown and the viewport edge. */
export const FACET_VIEWPORT_PAD = 8;

/** Which side of the row is hiding content right now. Drives BOTH the edge fade
 *  masks and the arrow buttons: a side with nothing hidden shows neither, so the
 *  first and last chip read crisp. The 2px slack absorbs sub-pixel scroll widths. */
export function overflowSides(m: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): { l: boolean; r: boolean } {
  const max = m.scrollWidth - m.clientWidth;
  return { l: m.scrollLeft > 2, r: max - m.scrollLeft > 2 };
}

/** Left offset for a chip's portaled dropdown, kept inside the viewport. The last
 *  chips sit at the right edge of a 1220px headbar, so anchoring naively on the
 *  chip's own left would push a 238px panel off-screen. */
export function clampDropLeft(
  left: number,
  viewportWidth: number,
  dropWidth: number = FACET_DROP_WIDTH,
): number {
  const rightMost = viewportWidth - dropWidth - FACET_VIEWPORT_PAD;
  return Math.max(FACET_VIEWPORT_PAD, Math.min(left, rightMost));
}
