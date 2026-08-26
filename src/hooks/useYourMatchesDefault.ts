import { useEffect, useRef } from "react";
import { settleMineDefault, shouldForceMineOff } from "@/lib/roles";

export type YourMatchesSignals = {
  authLoading: boolean;
  profileChecked: boolean;
  signedIn: boolean;
  hasCv: boolean;
  hasScore: boolean;
  /** The user's last EXPLICIT "Your matches" choice (readStoredMine()), or null
   *  when nothing is stored yet. */
  stored: boolean | null;
  /** The live filter value, so the force-off effect can see a stale "on". */
  mine: boolean;
};

/** Wires the "Your matches" (issue #154) default-on + force-off rules to a
 *  page's filter state — WITHOUT ever writing to storage itself (fix round 1,
 *  blocker 1). `setMine` here must be the PLAIN filter setter (updates
 *  `filters.mine` only); persisting a value to localStorage is the caller's
 *  job for an EXPLICIT user toggle alone (a header-chip click, a panel
 *  dismiss), never for a computed default or a forced-off transition. The old
 *  bug: every anonymous visitor lands before Google OAuth resolves, the
 *  settle effect used to fire on that very first render, and it wrote the
 *  computed default — "false" — to storage as if the user had chosen it,
 *  which then permanently overrode `shouldDefaultMineOn` for that browser on
 *  every later, signed-in-with-a-CV visit. Persisting ONLY explicit choices
 *  makes a stored value trustworthy as "the user chose this" (settleMineDefault
 *  and shouldDefaultMineOn both already assume that contract — see lib/roles.ts).
 *
 *  Settle-once (mirrors the old inline effect): waits for `settleMineDefault`
 *  to stop returning "wait", then applies the computed default exactly once.
 *  Force-off (mirrors the old inline effect): on every signedIn/hasCv/mine
 *  change thereafter, snaps a stale "on" back off for a mid-session sign-out
 *  or CV clearing (SPA, no reload — the settle effect is one-shot and never
 *  revisits it). Pure decisions live in lib/roles.ts (settleMineDefault /
 *  shouldForceMineOff); this hook only wires them to effects, so it is the
 *  policy-level surface a component test can exercise without mounting the
 *  full, heavy RolesMap page (Supabase, the globe, useRolesData). */
export function useYourMatchesDefault(signals: YourMatchesSignals, setMine: (next: boolean) => void): void {
  const settled = useRef(false);
  useEffect(() => {
    // Fix round 3, blocker 1: while `hasCv` is false, this render can never
    // leave `settled` locked — clear it FIRST, on every dep change, not only
    // on a value change of hasCv itself. A stored explicit choice skips
    // settleMineDefault's wait branch entirely (lib/roles.ts), so the block
    // below can still resolve a concrete decision (shouldDefaultMineOn
    // correctly returns false for !hasCv) on a render where hasCv is false —
    // the normal page-load order, profileChecked landing before the CV
    // submission does. That decision is real for THIS render but not the
    // FINAL word, so it must never lock. Round 2's fix instead used a
    // SEPARATE effect keyed on `[hasCv]` alone to clear the lock, which only
    // reset it on a hasCv value CHANGE — so two false renders in a row (auth
    // resolving, then profileChecked landing, hasCv unchanged both times)
    // let the settle block below lock on the second one without the reset
    // effect ever re-firing to catch it, and a later true render found
    // itself already locked out. Clearing inline, on every pass through this
    // same effect, removes the gap: hasCv is checked exactly where the lock
    // is set, every time.
    if (!signals.hasCv) settled.current = false;
    if (settled.current) return;
    const decision = settleMineDefault(signals);
    if (decision === "wait") return;
    setMine(decision);
    if (signals.hasCv) settled.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals.authLoading, signals.profileChecked, signals.signedIn, signals.hasCv, signals.hasScore, signals.stored]);

  useEffect(() => {
    if (shouldForceMineOff({ signedIn: signals.signedIn, hasCv: signals.hasCv, mine: signals.mine }))
      setMine(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals.signedIn, signals.hasCv, signals.mine]);
}
