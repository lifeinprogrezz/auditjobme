import { describe, it, expect } from "vitest";
import {
  COLLECTING_QUIET_MS,
  ETA_MAX_MS,
  estimateRemainingMs,
  formatRemaining,
  scoringPhaseOf,
  scoringProgressOf,
  type ScoringProgressInput,
} from "@/lib/scoringProgress";

// Issue #149. The rail and the Today tab render whatever this returns, so the
// phase rules and the copy live here rather than in two components that can drift.

const base: ScoringProgressInput = {
  hasCv: true,
  ready: true,
  total: 236,
  scored: 40,
  batchPending: false,
  sinceLastScoreMs: 0,
};

describe("scoringPhaseOf", () => {
  it("renders nothing without a CV", () => {
    expect(scoringPhaseOf({ ...base, hasCv: false })).toBeNull();
  });

  it("reads the CV while the map data and the profile are still settling", () => {
    expect(scoringPhaseOf({ ...base, ready: false, total: 0, scored: 0 })).toBe("reading-cv");
    // Even with a stale count in hand: not settled means the count is not an answer.
    expect(scoringPhaseOf({ ...base, ready: false })).toBe("reading-cv");
  });

  it("renders nothing for a settled but empty slice, which is never scoring", () => {
    // #114: labels that match nothing get an EMPTY slice on purpose. A bar there
    // would promise work that is not coming.
    expect(scoringPhaseOf({ ...base, total: 0, scored: 0 })).toBeNull();
  });

  it("scores while the slice is filling", () => {
    expect(scoringPhaseOf(base)).toBe("scoring");
  });

  it("stays on scoring while results are still arriving, batch or no batch", () => {
    expect(scoringPhaseOf({ ...base, batchPending: true, sinceLastScoreMs: 0 })).toBe("scoring");
    expect(
      scoringPhaseOf({ ...base, batchPending: true, sinceLastScoreMs: COLLECTING_QUIET_MS - 1 }),
    ).toBe("scoring");
  });

  it("collects once an open batch is the only thing left", () => {
    expect(
      scoringPhaseOf({ ...base, batchPending: true, sinceLastScoreMs: COLLECTING_QUIET_MS }),
    ).toBe("collecting");
  });

  it("never says collecting without an open batch, however long the quiet", () => {
    expect(scoringPhaseOf({ ...base, batchPending: false, sinceLastScoreMs: 10 * 60_000 })).toBe(
      "scoring",
    );
  });

  it("is done when the slice is fully scored, even with a batch row left open", () => {
    expect(scoringPhaseOf({ ...base, scored: 236 })).toBe("done");
    expect(scoringPhaseOf({ ...base, scored: 240 })).toBe("done");
    expect(
      scoringPhaseOf({ ...base, scored: 236, batchPending: true, sinceLastScoreMs: 10 * 60_000 }),
    ).toBe("done");
  });
});

describe("scoringProgressOf — copy and bar", () => {
  it("names the count it is scoring", () => {
    const view = scoringProgressOf(base);
    expect(view).toMatchObject({ headline: "Scoring 236 roles", detail: "40 done" });
    expect(view?.fraction).toBeCloseTo(40 / 236);
  });

  it("keeps the honest count while collecting", () => {
    const view = scoringProgressOf({
      ...base,
      batchPending: true,
      sinceLastScoreMs: COLLECTING_QUIET_MS,
    });
    expect(view).toMatchObject({ headline: "Collecting the rest", detail: "40 of 236 done" });
  });

  it("claims no count before the slice is known", () => {
    const view = scoringProgressOf({ ...base, ready: false, total: 0, scored: 0 });
    expect(view).toMatchObject({ headline: "Reading your CV", detail: null, fraction: 0 });
  });

  it("closes the bar when everything is scored", () => {
    const view = scoringProgressOf({ ...base, scored: 236 });
    expect(view).toMatchObject({ headline: "All 236 scored", detail: null, fraction: 1 });
  });

  it("never shows more scored than the slice holds", () => {
    const view = scoringProgressOf({ ...base, total: 10, scored: 25 });
    expect(view?.scored).toBe(10);
    expect(view?.fraction).toBe(1);
  });

  it("renders nothing without a CV", () => {
    expect(scoringProgressOf({ ...base, hasCv: false })).toBeNull();
  });

  it("writes no em-dashes anywhere in the copy", () => {
    const inputs: ScoringProgressInput[] = [
      base,
      { ...base, ready: false, total: 0, scored: 0 },
      { ...base, scored: 236 },
      { ...base, batchPending: true, sinceLastScoreMs: COLLECTING_QUIET_MS },
    ];
    for (const input of inputs) {
      const view = scoringProgressOf(input);
      expect(`${view?.headline} ${view?.detail ?? ""}`).not.toContain("—");
    }
  });
});

describe("estimateRemainingMs — a measured rate or no number at all", () => {
  it("says nothing before enough has landed in front of the user", () => {
    expect(estimateRemainingMs({ landed: 3, elapsedMs: 60_000, remaining: 100 })).toBeNull();
  });

  it("says nothing before enough time has passed to measure a rate", () => {
    expect(estimateRemainingMs({ landed: 40, elapsedMs: 1_000, remaining: 100 })).toBeNull();
  });

  it("projects the watched pace onto what is left", () => {
    // 40 scores in 40 s = 1/s, 100 left = 100 s.
    expect(estimateRemainingMs({ landed: 40, elapsedMs: 40_000, remaining: 100 })).toBe(100_000);
  });

  it("says nothing when there is nothing left", () => {
    expect(estimateRemainingMs({ landed: 40, elapsedMs: 40_000, remaining: 0 })).toBeNull();
  });

  it("says nothing rather than a number nobody should plan around", () => {
    const tooSlow = estimateRemainingMs({ landed: 8, elapsedMs: 60_000, remaining: 100_000 });
    expect(tooSlow).toBeNull();
    expect(ETA_MAX_MS).toBeGreaterThan(0);
  });
});

describe("formatRemaining", () => {
  it("rounds to minutes and never implies second-level precision", () => {
    expect(formatRemaining(20_000)).toBe("less than a minute left");
    expect(formatRemaining(61_000)).toBe("about 1 minute left");
    expect(formatRemaining(4 * 60_000)).toBe("about 4 minutes left");
  });
});
