import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Imperative read of the OS/browser reduced-motion preference — SSR-safe (no
 * `window`/`matchMedia` → false, motion is the default). Use this directly in
 * code that can't call hooks (event handlers, closures built once at map init,
 * like GlobeMap's camera moves).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

/** Reactive variant for components that should re-render if the OS setting
 *  changes mid-session. Mirrors the useIsMobile pattern in use-mobile.tsx. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
