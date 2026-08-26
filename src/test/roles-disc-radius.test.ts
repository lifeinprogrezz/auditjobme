// Pins discRadiusFor (src/hooks/useRolesData.ts), issue #153 item B2: the
// office-less sunflower disc widens with how many companies actually share it,
// so a dense city (Barcelona, London, Berlin) fans pins out instead of stacking
// them at a fixed radius. Pure function, no DOM, no network.
import { describe, expect, it } from "vitest";
import { discRadiusFor } from "@/hooks/useRolesData";

describe("discRadiusFor", () => {
  it("reproduces the original fixed radius (~0.0085°) at the reference count of 10", () => {
    expect(discRadiusFor(10)).toBeCloseTo(0.0085, 5);
  });

  it("grows with company count below the cap", () => {
    const r10 = discRadiusFor(10);
    const r40 = discRadiusFor(40);
    const r90 = discRadiusFor(90);
    expect(r40).toBeGreaterThan(r10);
    expect(r90).toBeGreaterThan(r40);
  });

  it("a dense city (>30 office-less companies) is visibly wider than the base radius", () => {
    expect(discRadiusFor(40)).toBeGreaterThan(discRadiusFor(10) * 1.5);
  });

  it("caps at 0.03° how ever many companies share the disc", () => {
    expect(discRadiusFor(500)).toBeCloseTo(0.03, 5);
    expect(discRadiusFor(100000)).toBeCloseTo(0.03, 5);
  });

  it("never grows for n=0 or n=1 (a lone company sits near the centroid)", () => {
    expect(discRadiusFor(0)).toBeLessThan(discRadiusFor(10));
    expect(discRadiusFor(1)).toBeLessThan(discRadiusFor(10));
  });

  it("is monotonic non-decreasing in n", () => {
    let prev = discRadiusFor(0);
    for (const n of [1, 2, 5, 10, 20, 30, 50, 100, 300, 1000]) {
      const r = discRadiusFor(n);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });
});
