import { describe, expect, it } from "vitest";
import {
  shouldReveal,
  revealProgressLabel,
  REVEAL_MIN_SCORES,
  REVEAL_CAP_MS,
} from "@/lib/scoreReveal";

// The gate that holds the CV screen until the first roles are scored. Measured on
// the 2026-08-26 signup: 15 roles inside the first minute, all 40 by the second.
describe("shouldReveal", () => {
  it("holds while fewer than the needed roles are scored", () => {
    expect(shouldReveal(0, 0)).toBe(false);
    expect(shouldReveal(REVEAL_MIN_SCORES - 1, 0)).toBe(false);
  });

  it("opens as soon as enough roles carry a score", () => {
    expect(shouldReveal(REVEAL_MIN_SCORES, 0)).toBe(true);
    expect(shouldReveal(REVEAL_MIN_SCORES + 20, 0)).toBe(true);
  });

  // The release valve. A stall must cost a plainer first view, never a trapped user.
  it("opens at the cap even with nothing scored (mutant: drop the cap)", () => {
    expect(shouldReveal(0, REVEAL_CAP_MS)).toBe(true);
    expect(shouldReveal(0, REVEAL_CAP_MS + 1)).toBe(true);
    expect(shouldReveal(0, REVEAL_CAP_MS - 1)).toBe(false);
  });

  // The 45s cap first considered would have fired before the measured ~60s, so the
  // gate would have released early nearly every time and done nothing at all.
  it("keeps the cap ABOVE the measured time for the first batch", () => {
    expect(REVEAL_CAP_MS).toBeGreaterThan(60_000);
  });

  it("honours explicit overrides, so the numbers stay tunable in one place", () => {
    expect(shouldReveal(3, 0, 5, 1000)).toBe(false);
    expect(shouldReveal(5, 0, 5, 1000)).toBe(true);
    expect(shouldReveal(0, 1000, 5, 1000)).toBe(true);
  });
});

describe("revealProgressLabel", () => {
  it("counts up to the target", () => {
    expect(revealProgressLabel(0)).toBe(`0 of ${REVEAL_MIN_SCORES}`);
    expect(revealProgressLabel(11)).toBe(`11 of ${REVEAL_MIN_SCORES}`);
  });

  it("never overshoots when a fast batch lands more than needed", () => {
    expect(revealProgressLabel(40)).toBe(`${REVEAL_MIN_SCORES} of ${REVEAL_MIN_SCORES}`);
  });

  it("never reports a negative count", () => {
    expect(revealProgressLabel(-3)).toBe(`0 of ${REVEAL_MIN_SCORES}`);
  });
});
