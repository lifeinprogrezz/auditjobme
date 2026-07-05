import { describe, expect, it } from "vitest";
import { clusterTier } from "@/lib/roles";

// Startupmap-matched tier ladder (spec: planning repo
// docs/specs/2026-07-05-startupmap-motion-choreography.md §4.5):
// count breaks <15 / ≥15 / ≥50 / ≥150, light glass below 50, ink above,
// z ladder 20/22/24. No sublabel on any tier — the "roles" word under the
// count pushed the number off the bubble's center (removed 7-05).
describe("clusterTier", () => {
  it("smallest tier: 2–14 → 44px light, z20", () => {
    for (const n of [2, 9, 14]) {
      expect(clusterTier(n)).toEqual({
        size: 44,
        fontSize: 13.5,
        light: true,
        zIndex: 20,
      });
    }
  });

  it("mid tier: 15–49 → 54px still light, z20", () => {
    for (const n of [15, 30, 49]) {
      expect(clusterTier(n)).toEqual({
        size: 54,
        fontSize: 14,
        light: true,
        zIndex: 20,
      });
    }
  });

  it("hub tier: 50–149 → 64px ink, z22", () => {
    for (const n of [50, 100, 149]) {
      expect(clusterTier(n)).toEqual({
        size: 64,
        fontSize: 15,
        light: false,
        zIndex: 22,
      });
    }
  });

  it("mega tier: ≥150 → 76px ink, z24, count only (no sublabel)", () => {
    for (const n of [150, 400]) {
      expect(clusterTier(n)).toEqual({
        size: 76,
        fontSize: 17,
        light: false,
        zIndex: 24,
      });
    }
  });

  it("light→ink weight break sits exactly at 50 (startupmap's hub split)", () => {
    expect(clusterTier(49).light).toBe(true);
    expect(clusterTier(50).light).toBe(false);
  });
});
