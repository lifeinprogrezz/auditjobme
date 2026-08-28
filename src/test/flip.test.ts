import { describe, expect, it } from "vitest";
import { planFlip, FLIP_MIN_PX } from "@/lib/flip";

// The list re-ranks when a role gains a score. planFlip decides which cards glide
// and by how much; the hook only measures and plays. Rober, 2026-08-28: "can you
// make that jump smoother?"
describe("planFlip", () => {
  const layout = (pairs: [string, number][]) => new Map(pairs);

  it("moves a card by the distance it travelled — old top minus new top (mutant: flip the sign)", () => {
    const prev = layout([["a", 0], ["b", 100], ["c", 200]]);
    const next = layout([["c", 0], ["a", 100], ["b", 200]]); // c jumped to the top
    expect(planFlip(prev, next, false)).toEqual([
      { key: "c", dy: 200 }, // it WAS 200px lower, so it starts +200 and glides to 0
      { key: "a", dy: -100 },
      { key: "b", dy: -100 },
    ]);
  });

  it("does nothing for a list that did not re-rank", () => {
    const same = layout([["a", 0], ["b", 100]]);
    expect(planFlip(same, same, false)).toEqual([]);
  });

  it("ignores sub-pixel jitter so a still list never shimmers", () => {
    const prev = layout([["a", 0]]);
    const next = layout([["a", FLIP_MIN_PX / 2]]);
    expect(planFlip(prev, next, false)).toEqual([]);
  });

  it("skips a card that is new — there is nowhere to glide from", () => {
    const prev = layout([["a", 0]]);
    const next = layout([["z", 0], ["a", 100]]);
    expect(planFlip(prev, next, false)).toEqual([{ key: "a", dy: -100 }]);
  });

  it("skips a card that is gone — there is nothing left to move", () => {
    const prev = layout([["a", 0], ["b", 100]]);
    const next = layout([["b", 0]]);
    expect(planFlip(prev, next, false)).toEqual([{ key: "b", dy: 100 }]);
  });

  it("plans NO moves under prefers-reduced-motion (mutant: ignore the flag)", () => {
    const prev = layout([["a", 0], ["b", 100]]);
    const next = layout([["b", 0], ["a", 100]]);
    expect(planFlip(prev, next, true)).toEqual([]);
  });

  it("first render has no previous layout, so nothing animates in", () => {
    expect(planFlip(new Map(), layout([["a", 0], ["b", 100]]), false)).toEqual([]);
  });
});
