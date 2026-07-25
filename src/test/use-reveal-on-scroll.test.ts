// Pins useRevealOnScroll — the Today "More matches" infinite reveal (Rober 7-25).
// This exists BECAUSE the first implementation (IntersectionObserver) shipped
// green and then didn't fire in the live session: IO isn't implemented in jsdom,
// so nothing could pin it. Scroll math is — so the load-bearing behaviors are
// locked here: reveal when the sentinel nears the viewport, chain reveals while
// it stays near (yank-to-bottom), stop when the tail is exhausted, never reveal
// while the sentinel is far away.
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRevealOnScroll } from "@/hooks/useRevealOnScroll";

/** Mount a fake sentinel whose distance-from-viewport we control. */
function attachSentinel(ref: React.RefObject<HTMLDivElement | null>, topPx: number) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ top: topPx, bottom: topPx + 10, left: 0, right: 10, width: 10, height: 10, x: 0, y: topPx, toJSON: () => ({}) }) as DOMRect;
  (ref as { current: HTMLDivElement | null }).current = el;
  return {
    place(newTop: number) {
      el.getBoundingClientRect = () =>
        ({ top: newTop, bottom: newTop + 10, left: 0, right: 10, width: 10, height: 10, x: 0, y: newTop, toJSON: () => ({}) }) as DOMRect;
    },
  };
}

const scroll = () => act(() => void window.dispatchEvent(new Event("scroll")));

describe("useRevealOnScroll", () => {
  it("starts at one step and exposes hasMore for a deep tail", () => {
    const { result } = renderHook(() => useRevealOnScroll(800, 30, 800));
    expect(result.current.shown).toBe(30);
    expect(result.current.hasMore).toBe(true);
  });

  it("reveals another step when the sentinel scrolls within the margin — and stops once it's pushed away", () => {
    const { result } = renderHook(() => useRevealOnScroll(800, 30, 800));
    const sentinel = attachSentinel(result.current.sentinelRef, 99999); // far below
    scroll();
    expect(result.current.shown).toBe(30); // far away → no reveal

    // In a real DOM the newly revealed rows push the sentinel back down — model
    // that: come into range for ONE reveal, then sit far again.
    let revealed = false;
    sentinel.place(window.innerHeight + 400); // inside the 800px margin
    const el = result.current.sentinelRef.current!;
    const near = el.getBoundingClientRect;
    el.getBoundingClientRect = () => {
      if (revealed) return { top: 99999, bottom: 99999, left: 0, right: 10, width: 10, height: 10, x: 0, y: 99999, toJSON: () => ({}) } as DOMRect;
      revealed = true;
      return near();
    };
    scroll();
    expect(result.current.shown).toBe(60);
  });

  it("chains reveals while the sentinel stays near (yank to the bottom) until the tail is exhausted", () => {
    const { result } = renderHook(() => useRevealOnScroll(200, 30, 800));
    attachSentinel(result.current.sentinelRef, 100); // pinned near: always in range
    // One scroll starts it; each reveal re-runs the effect (shown in deps) whose
    // immediate check reveals the next batch — cascading with no further events.
    scroll();
    expect(result.current.shown).toBeGreaterThanOrEqual(200);
    expect(result.current.hasMore).toBe(false);
  });

  it("does nothing once the tail is exhausted", () => {
    const { result, rerender } = renderHook(() => useRevealOnScroll(20, 30, 800));
    expect(result.current.hasMore).toBe(false);
    attachSentinel(result.current.sentinelRef, 0);
    rerender();
    scroll();
    expect(result.current.shown).toBe(30); // never grows past need
  });
});
