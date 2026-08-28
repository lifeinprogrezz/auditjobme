// useFlip — glide list items to their new position instead of teleporting.
// The decision of what moves lives in src/lib/flip.ts (pure, tested); this hook
// only measures the DOM and plays the animation. See the header there for why.
import { useLayoutEffect, useRef, type RefObject } from "react";
import { planFlip } from "@/lib/flip";

/** Matches the card's own transition timing so a re-rank and a hover feel like
 *  one motion system, not two. */
const FLIP_MS = 380;
const FLIP_EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";

/**
 * Every render, compare where each `[data-flip]` child sits now with where it sat
 * after the previous render, and animate the delta. Runs unconditionally: the
 * list is capped (CARD_CAP), so measuring it is cheap, and gating on a dependency
 * would miss re-ranks caused by data the caller did not think to list.
 *
 * Safe everywhere it can run: no container, no `animate` (jsdom, old engines) or a
 * zero-rect environment simply plans no moves.
 */
export function useFlip(container: RefObject<HTMLElement | null>, selector: string): void {
  const last = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const next = new Map<string, number>();
    const els = new Map<string, HTMLElement>();
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
      const key = el.dataset.flip;
      if (!key) continue;
      next.set(key, el.getBoundingClientRect().top);
      els.set(key, el);
    }
    const reduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const { key, dy } of planFlip(last.current, next, reduce)) {
      const el = els.get(key);
      if (!el || typeof el.animate !== "function") continue;
      el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
        { duration: FLIP_MS, easing: FLIP_EASE },
      );
    }
    last.current = next;
  });
}
