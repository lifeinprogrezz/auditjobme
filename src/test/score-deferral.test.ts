// Guard: the score-arrival rebuild stays non-urgent (issue #54).
//
// While the server scores a backlog, the page polls every 20 seconds and each flush
// rebuilds everything derived from the score map: the jobs sort, the Today queue, the
// map facets and the markers. That work has to run at transition priority, or a click
// during the drain waits behind a synchronous rebuild.
//
// The first attempt wrapped the cache write in `startTransition` and read as if it
// worked. It does not. `useQuery` subscribes through `useSyncExternalStore`, so a store
// change re-renders on SyncLane no matter which transition the write happened in, and
// TanStack's notifyManager batches the notification into a `setTimeout(0)` that has
// already left the transition's scope when it fires. Nothing failed, because the
// coalescer still merged the flushes and structural sharing still skipped the unchanged
// ones — the deferral was simply absent while the code and the report both claimed it.
//
// `useDeferredValue` on the query's data is the version React honours. This test is a
// SOURCE pin, not a behaviour pin, deliberately: scheduling priority has no observable
// output in jsdom, so what can be protected is the one line that carries it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(process.cwd(), "src/hooks/useRolesData.ts"), "utf8");
/** Comments explain the trap by name, so the assertions read the CODE only. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("score arrival is deferred, not urgent (issue #54)", () => {
  it("defers the query data that feeds the derived rebuild", () => {
    expect(CODE).toContain("useDeferredValue(scoresQ.data)");
  });

  it("builds the landed-score map off the DEFERRED value", () => {
    // Inlining `scoresQ.data` back into the memo drops the deferral without removing
    // the `useDeferredValue` call, which is the quiet way this regresses.
    expect(CODE).toMatch(/landedScoreMap\(deferredScores\s*\?\?/);
    expect(CODE).not.toMatch(/landedScoreMap\(scoresQ\.data/);
  });

  it("does not reach for startTransition around the cache write", () => {
    // The pattern that looked right and did nothing. If a future change needs
    // startTransition for something else, it needs its own evidence that React
    // honours it — so this pin fails loudly rather than quietly allowing it back.
    expect(CODE).not.toContain("startTransition");
  });
});
