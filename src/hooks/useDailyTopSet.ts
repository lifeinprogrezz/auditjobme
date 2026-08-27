// Persists the frozen "top matches" set (issue #155, LOCKED decision 2). Deliberately
// its OWN hook, not another branch of useRolesData: only /today needs this, and the
// freeze/read is a single small own-row table, same reasoning as useDailyMatches.ts.
// Pure selection logic (the freeze itself, done-marking, rollover) lives in
// lib/product.ts's dailyTopTen(), pinned by product.test.ts; this hook only wires it
// to Supabase + a localStorage fallback.
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { utcDayKey, type DailyTopSetSnapshot } from "@/lib/product";
import {
  isMissingDailyTopSetsTable,
  readLocalDailyTopSet,
  writeLocalDailyTopSet,
} from "@/lib/dailyTopSet";

export interface DailyTopSetState {
  today: string;
  loading: boolean;
  /** Today's frozen set, or null while none has been frozen yet. */
  snapshot: DailyTopSetSnapshot | null;
}

/** Postgres unique_violation — another tab/device froze today's set first. */
const UNIQUE_VIOLATION = "23505";

/**
 * Loads today's frozen top-ten snapshot, and freezes one (once) when none exists yet.
 *
 * `candidateIds` is the CURRENT best-ranked top ten (buildActionQueue's live queue,
 * sliced to 10) — read ONLY to seed a brand-new day's freeze. Once a snapshot is
 * loaded (from the table or its localStorage fallback), every later render ignores
 * `candidateIds` completely: dailyTopTen() replays the frozen ids, so an apply or
 * dismiss elsewhere in the app can change `candidateIds` all it wants without ever
 * re-freezing the same day.
 *
 * `ready` gates the freeze itself (issue #155 fix-round-1 blockers 1 + 3) — the
 * caller computes it with `dailyTopSetReady` in lib/product.ts (see its doc comment
 * for the full rationale: this hook's own `loading` above does NOT cover the other
 * own-row reads `candidateIds` is built from, and a wrong freeze cannot self-heal —
 * no UPDATE/DELETE policy on daily_top_sets). While `ready` is false the freeze
 * effect below is a no-op every render; the page keeps rendering the LIVE top from
 * `candidateIds`, exactly as it does today.
 */
export function useDailyTopSet(candidateIds: string[], ready: boolean): DailyTopSetState {
  const { user } = useAuth();
  const today = utcDayKey();
  const [state, setState] = useState<DailyTopSetState>({ today, loading: true, snapshot: null });
  const freezing = useRef(false);

  // Load today's snapshot (or clear on sign-out / a day rollover mid-session).
  useEffect(() => {
    let cancelled = false;
    freezing.current = false;
    if (!user) {
      setState({ today, loading: false, snapshot: null });
      return;
    }
    setState({ today, loading: true, snapshot: null });
    (async () => {
      const { data, error } = await supabase
        .from("daily_top_sets")
        .select("job_ids")
        .eq("user_id", user.id)
        .eq("day", today)
        .maybeSingle();
      if (cancelled) return;
      if (!error) {
        setState({
          today,
          loading: false,
          snapshot: data ? { day: today, jobIds: data.job_ids ?? [] } : null,
        });
        return;
      }
      // Missing table (pre-migration) or any other read failure: fall back to the
      // local copy rather than losing the freeze. A genuinely absent local entry
      // just means the freeze effect below runs and (re-)creates it.
      setState({ today, loading: false, snapshot: readLocalDailyTopSet(user.id, today) });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, today]);

  // Freeze once: only once signed in, the load above finished, no snapshot exists
  // yet, the caller says `ready` (every own-row read `candidateIds` depends on has
  // landed, and scoring is either done or the ten is full), and a real ranked ten
  // is ready — never freeze an empty/still-loading queue.
  useEffect(() => {
    if (!ready || !user || state.loading || state.snapshot || freezing.current) return;
    if (candidateIds.length === 0) return;
    freezing.current = true;
    const snapshot: DailyTopSetSnapshot = { day: today, jobIds: candidateIds };
    (async () => {
      const { error } = await supabase
        .from("daily_top_sets")
        .insert({ user_id: user.id, day: today, job_ids: snapshot.jobIds });
      if (!error) {
        setState({ today, loading: false, snapshot });
        return;
      }
      if (error.code === UNIQUE_VIOLATION) {
        // Lost the race to another tab/device — read back the set that won instead
        // of trusting our own candidate list.
        const { data } = await supabase
          .from("daily_top_sets")
          .select("job_ids")
          .eq("user_id", user.id)
          .eq("day", today)
          .maybeSingle();
        setState({
          today,
          loading: false,
          snapshot: data ? { day: today, jobIds: data.job_ids ?? [] } : snapshot,
        });
        return;
      }
      // Missing table, offline, or any other write failure: keep the feature
      // working locally rather than losing the freeze.
      if (!isMissingDailyTopSetsTable(error)) {
        // An unexpected failure — still degrade to local, but worth knowing about.
        console.warn("[useDailyTopSet] freeze write failed, falling back to local", error.message);
      }
      writeLocalDailyTopSet(user.id, snapshot);
      setState({ today, loading: false, snapshot });
    })();
  }, [ready, user, today, state.loading, state.snapshot, candidateIds]);

  return state;
}
