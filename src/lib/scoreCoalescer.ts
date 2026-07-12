// Coalesce score-arrival batches into ONE state commit per flush window (issue #54).
//
// The server backlog worker (issue #33) streams landed scores while a re-score wave
// drains. The /roles map and /today queue read them by POLLING: each poll pulls the
// user's full landed-score set and re-applies + re-sorts the whole catalog. Applied
// per arrival, that rebuild (Today's action queue, the map's ~10 cross-faceted option
// passes, the globe's marker resync) runs on EVERY batch — with real data the main
// thread stalls and clicks drop. Buffering merges any batches that arrive inside the
// window into a SINGLE flush, so the expensive derived-list rebuild runs once per
// window instead of once per batch.
//
// Polling cadence is untouched (the hook still polls on its own interval) and the
// merged map still carries every real landed score, so the "Scoring… N to go" count
// stays honest. The scheduler is injectable so the coalescing is deterministically
// testable (scoreCoalescer.test.ts) without leaning on wall-clock timers.

export interface ScoreBuffer<V> {
  /** Merge a landed batch into the pending set and schedule a flush (if none is pending). */
  push(landed: ReadonlyMap<string, V>): void;
  /** Drop any pending batch + scheduled flush. Called on the run boundary (user change /
   *  unmount) so a batch buffered for user A can never land in user B's freshly-loaded view. */
  cancel(): void;
}

/**
 * Build a coalescing buffer. `flush` receives the union of every batch pushed within a
 * window (later values win on key collision — each poll's map is a full snapshot, so the
 * union is simply the freshest complete set). `schedule`/`cancelScheduled` default to a
 * macrotask so pushes made in the same tick collapse into one flush; inject a manual
 * scheduler in tests for deterministic control.
 */
export function createScoreBuffer<V>(
  flush: (merged: Map<string, V>) => void,
  schedule: (cb: () => void) => unknown = (cb) => setTimeout(cb, 0),
  cancelScheduled: (handle: unknown) => void = (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
): ScoreBuffer<V> {
  let pending: Map<string, V> | null = null;
  let handle: unknown = null;

  const doFlush = () => {
    handle = null;
    const merged = pending;
    pending = null;
    if (merged && merged.size > 0) flush(merged);
  };

  return {
    push(landed) {
      if (landed.size === 0) return;
      if (!pending) pending = new Map<string, V>();
      for (const [k, v] of landed) pending.set(k, v);
      if (handle === null) handle = schedule(doFlush);
    },
    cancel() {
      if (handle !== null) {
        cancelScheduled(handle);
        handle = null;
      }
      pending = null;
    },
  };
}
