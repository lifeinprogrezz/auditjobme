import { describe, expect, it } from "vitest";
import { clusterTier } from "@/lib/roles";

// Startupmap-matched tier ladder (spec: planning repo
// docs/specs/2026-07-05-startupmap-motion-choreography.md §4.5), re-keyed on
// ROLES 2026-08-28: breaks <60 / ≥60 / ≥200 / ≥600, light glass below 200, ink
// above, z ladder 20/22/24. No sublabel on any tier — the "roles" word under the
// count pushed the number off the bubble's center (removed 7-05).
//
// The breaks moved because the bubble's NUMBER changed meaning, not its style: a
// cluster used to report how many company pins it held and now reports the roles
// inside them (~4.8 per pin). Left at 15/50/150 every cluster would have gone
// mega and the ladder would have flattened. 60/200/600 is measured against the
// live dataplane, not scaled — see the comment on clusterTier.
describe("clusterTier", () => {
  it("smallest tier: 2–59 roles → 44px light, z20", () => {
    for (const n of [2, 30, 59]) {
      expect(clusterTier(n)).toEqual({ size: 44, fontSize: 13.5, light: true, zIndex: 20 });
    }
  });

  it("mid tier: 60–199 roles → 54px still light, z20", () => {
    for (const n of [60, 120, 199]) {
      expect(clusterTier(n)).toEqual({ size: 54, fontSize: 14, light: true, zIndex: 20 });
    }
  });

  it("hub tier: 200–599 roles → 64px ink, z22", () => {
    for (const n of [200, 400, 599]) {
      expect(clusterTier(n)).toEqual({ size: 64, fontSize: 15, light: false, zIndex: 22 });
    }
  });

  it("mega tier: ≥600 roles → 76px ink, z24, count only (no sublabel)", () => {
    for (const n of [600, 1581, 8189]) {
      expect(clusterTier(n)).toEqual({ size: 76, fontSize: 17, light: false, zIndex: 24 });
    }
  });

  it("light→ink weight break sits exactly at 200 roles (startupmap's hub split)", () => {
    expect(clusterTier(199).light).toBe(true);
    expect(clusterTier(200).light).toBe(false);
  });

  // The regression guard. These are the four largest real city clusters and the
  // whole-globe bubble, at their measured role counts. Under the OLD pin-keyed
  // breaks every one of them lands in the mega tier — which is exactly the
  // flattening this rescale exists to prevent, so this case is what proves the
  // ladder still separates them.
  it("keeps the real hubs on DIFFERENT rungs (mutant: restore the 15/50/150 breaks)", () => {
    const sizes = {
      globe: clusterTier(8189).size, // every role, one bubble
      london: clusterTier(1581).size,
      berlin: clusterTier(930).size,
      dublin: clusterTier(276).size,
      madrid: clusterTier(146).size,
      warsawSmall: clusterTier(41).size,
    };
    expect(sizes).toEqual({
      globe: 76,
      london: 76,
      berlin: 76,
      dublin: 64,
      madrid: 54,
      warsawSmall: 44,
    });
    // Four distinct rungs in use, not one.
    expect(new Set(Object.values(sizes)).size).toBe(4);
  });
});
