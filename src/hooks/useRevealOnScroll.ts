// useRevealOnScroll — incremental list reveal driven by PLAIN scroll math, not
// IntersectionObserver (Rober 7-25: the IO version didn't fire in his live
// session; scroll+rect math has no observer lifecycle to get wrong, works in
// every browser, and — unlike IO — is testable in jsdom, so the behavior is
// pinned by useRevealOnScroll.test.ts).
//
// Contract: render `shown` items of the tail, and while more remain, mount the
// returned ref on a sentinel at the list end. Whenever the sentinel comes within
// `margin` px of the viewport bottom (scroll, resize, or a fresh reveal that
// still leaves it near — the effect re-runs per bump, so a yank-to-the-bottom
// chains batch after batch until the sentinel is pushed out of range), the next
// `step` items reveal. The list never paginates visibly: it just keeps going.
import { useEffect, useRef, useState } from "react";

export function useRevealOnScroll(total: number, step = 30, margin = 800) {
  const [shown, setShown] = useState(step);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = total > shown;

  useEffect(() => {
    if (!hasMore) return;
    const check = () => {
      const el = sentinelRef.current;
      if (!el) return;
      if (el.getBoundingClientRect().top < window.innerHeight + margin) {
        setShown((n) => n + step);
      }
    };
    // Immediate check: catches "already at the bottom" (fast scroll, short
    // viewport, deep-link) without waiting for the next scroll event.
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check, { passive: true });
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [hasMore, shown, step, margin]);

  return { shown, hasMore, sentinelRef };
}
