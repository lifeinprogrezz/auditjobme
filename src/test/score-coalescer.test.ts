// Pins the score-arrival coalescer (issue #54): a stream of landed-score batches that
// arrive inside one flush window must collapse into a SINGLE commit (one derived-list
// rebuild / one map re-render), while still carrying every real score so "N to go"
// stays honest. Uses a manual scheduler so the coalescing is asserted deterministically,
// standing in for the render-count profile the live re-score wave would show.
import { describe, expect, it, vi } from "vitest";
import { createScoreBuffer } from "@/lib/scoreCoalescer";

/** A manual scheduler: captures the flush callback so the test decides when the window
 *  closes, exactly modelling "N pushes land, THEN one flush fires". */
function manualScheduler() {
  let queued: (() => void) | null = null;
  return {
    schedule: (cb: () => void) => {
      queued = cb;
      return 1;
    },
    cancel: () => {
      queued = null;
    },
    /** Close the window: run the single scheduled flush (if any). */
    tick: () => {
      const cb = queued;
      queued = null;
      cb?.();
    },
    get pending() {
      return queued !== null;
    },
  };
}

const m = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("createScoreBuffer — score-arrival coalescing (issue #54)", () => {
  it("collapses a burst of batches into ONE flush", () => {
    const flush = vi.fn<(merged: Map<string, number>) => void>();
    const sched = manualScheduler();
    const buf = createScoreBuffer<number>(flush, sched.schedule, sched.cancel);

    // A stream of 40 batches (mirrors the comment: a wave re-sorts up to ~40 times)…
    for (let i = 0; i < 40; i++) buf.push(m({ [`job${i}`]: i }));
    // …schedules exactly one flush and has NOT committed yet.
    expect(flush).not.toHaveBeenCalled();
    expect(sched.pending).toBe(true);

    sched.tick();
    // One commit for the whole burst — not 40.
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("carries every landed score in the merged batch (honesty preserved)", () => {
    const flush = vi.fn<(merged: Map<string, number>) => void>();
    const sched = manualScheduler();
    const buf = createScoreBuffer<number>(flush, sched.schedule, sched.cancel);

    buf.push(m({ a: 1, b: 2 }));
    buf.push(m({ b: 20, c: 3 })); // later value wins on collision (freshest snapshot)
    sched.tick();

    expect(flush).toHaveBeenCalledTimes(1);
    const merged = flush.mock.calls[0][0];
    expect(merged.get("a")).toBe(1);
    expect(merged.get("b")).toBe(20);
    expect(merged.get("c")).toBe(3);
    expect(merged.size).toBe(3);
  });

  it("re-arms for the next window after a flush", () => {
    const flush = vi.fn<(merged: Map<string, number>) => void>();
    const sched = manualScheduler();
    const buf = createScoreBuffer<number>(flush, sched.schedule, sched.cancel);

    buf.push(m({ a: 1 }));
    sched.tick();
    expect(flush).toHaveBeenCalledTimes(1);

    buf.push(m({ b: 2 })); // a genuinely later poll → a fresh window, a second commit
    expect(sched.pending).toBe(true);
    sched.tick();
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush.mock.calls[1][0].get("b")).toBe(2);
  });

  it("ignores empty batches (no scores landed → no wasted commit)", () => {
    const flush = vi.fn<(merged: Map<string, number>) => void>();
    const sched = manualScheduler();
    const buf = createScoreBuffer<number>(flush, sched.schedule, sched.cancel);

    buf.push(new Map());
    expect(sched.pending).toBe(false);
    sched.tick();
    expect(flush).not.toHaveBeenCalled();
  });

  it("cancel() drops a buffered batch so it can't flush into the next run", () => {
    const flush = vi.fn<(merged: Map<string, number>) => void>();
    const sched = manualScheduler();
    const buf = createScoreBuffer<number>(flush, sched.schedule, sched.cancel);

    buf.push(m({ a: 1 })); // buffered for "user A"
    buf.cancel(); // run boundary: sign-out / user change
    sched.tick();
    expect(flush).not.toHaveBeenCalled();
  });

  it("defaults to a real macrotask scheduler when none is injected", async () => {
    const flush = vi.fn<(merged: Map<string, number>) => void>();
    const buf = createScoreBuffer<number>(flush);
    buf.push(m({ a: 1 }));
    buf.push(m({ a: 2 })); // same tick → coalesced
    expect(flush).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0][0].get("a")).toBe(2);
  });
});
