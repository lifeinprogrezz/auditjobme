// Pins the headbar facet row's geometry rules (lib/facetRow.ts). Both were live-UI
// defects on 2026-07-26: the nine chips overflow a 1220px headbar with no visible
// scroll cue, and the last chips' dropdowns anchor far enough right to leave the
// viewport. Rule + code move together — change these only alongside HeadBar/FilterChip.
import { describe, it, expect } from "vitest";
import {
  FACET_DROP_WIDTH,
  FACET_VIEWPORT_PAD,
  clampDropLeft,
  overflowSides,
} from "@/lib/facetRow";

describe("overflowSides", () => {
  it("a row that fits hides nothing → no fade, no arrows", () => {
    expect(overflowSides({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 })).toEqual({
      l: false,
      r: false,
    });
  });

  it("parked at the start → only the right side is hiding chips", () => {
    // The reported default state: 852px of chips in a 488px row at 1920x908.
    expect(overflowSides({ scrollLeft: 0, scrollWidth: 852, clientWidth: 488 })).toEqual({
      l: false,
      r: true,
    });
  });

  it("mid-scroll → both sides", () => {
    expect(overflowSides({ scrollLeft: 220, scrollWidth: 852, clientWidth: 488 })).toEqual({
      l: true,
      r: true,
    });
  });

  it("scrolled to the end → only the left side, so the last chip reads crisp", () => {
    expect(overflowSides({ scrollLeft: 364, scrollWidth: 852, clientWidth: 488 })).toEqual({
      l: true,
      r: false,
    });
  });

  it("sub-pixel scroll widths do not raise a phantom cue", () => {
    expect(overflowSides({ scrollLeft: 1, scrollWidth: 401.5, clientWidth: 400 })).toEqual({
      l: false,
      r: false,
    });
  });
});

describe("clampDropLeft", () => {
  it("leaves a dropdown with room to spare exactly under its chip", () => {
    expect(clampDropLeft(1119, 1920)).toBe(1119);
  });

  it("pulls a right-edge chip's dropdown back inside the viewport", () => {
    expect(clampDropLeft(1800, 1920)).toBe(1920 - FACET_DROP_WIDTH - FACET_VIEWPORT_PAD);
  });

  it("never goes past the left edge on a narrow viewport", () => {
    expect(clampDropLeft(4, 320)).toBe(FACET_VIEWPORT_PAD);
  });
});
