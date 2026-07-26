/**
 * Single call-site helper for firing PostHog product events (issue #89).
 *
 * No call site imports posthog-js directly. `main.tsx` loads it through a
 * dynamic import ON PURPOSE, with a comment explaining why: the analytics
 * bundle must never delay the map. This module performs its OWN dynamic
 * `import("posthog-js")` — caching the resolved module — so every event fired
 * anywhere in the app, however long after startup, stays lazy the same way.
 * It never calls `posthog.init(...)`: it only ever touches the ONE posthog-js
 * singleton `main.tsx` already configured, so every event still runs through
 * the `sanitize_properties` hook wired up there (see analytics-sanitize.ts) —
 * this module must never bypass, reorder, or reconfigure that hook.
 *
 * A no-op when `VITE_POSTHOG_KEY` isn't set, exactly like the init in
 * main.tsx, and a no-op — never throws — if the dynamic import fails for any
 * reason, or if posthog-js itself throws while capturing. A broken analytics
 * load must never break a user flow (uploading a CV, applying, etc).
 *
 * Properties passed to `track()` must be non-identifying by construction: a
 * word count, a boolean, a numeric score, a small count, a fixed string.
 * Never an email, a name, curriculum-vitae text, or any free text the user
 * typed — see the call sites in CvUnlockModal / RolesPanel / Apply.tsx.
 */
import type { PostHog } from "posthog-js";

export type AnalyticsProps = Record<string, string | number | boolean | null>;

let posthogPromise: Promise<PostHog | null> | null = null;

/** Lazily imports posthog-js and caches the resolved module. Returns null
 *  (without importing anything) when no key is configured. */
function loadPosthog(): Promise<PostHog | null> | null {
  if (!import.meta.env.VITE_POSTHOG_KEY) return null;
  if (!posthogPromise) {
    posthogPromise = import("posthog-js")
      .then((mod) => mod.default)
      .catch(() => null);
  }
  return posthogPromise;
}

/**
 * Fire one product event. No-op when no key is configured. Never throws —
 * fire-and-forget, so a call site never needs to await or catch it.
 */
export function track(event: string, props?: AnalyticsProps): void {
  try {
    const posthog = loadPosthog();
    if (!posthog) return;
    posthog.then((instance) => instance?.capture(event, props)).catch(() => {
      // A broken analytics load must never break a user flow.
    });
  } catch {
    // Same guarantee, for anything that could throw synchronously above.
  }
}
