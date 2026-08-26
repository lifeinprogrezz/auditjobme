import { describe, it, expect } from "vitest";
import { naturalPlace, discRadiusFor, BATCH_REKICK_MS } from "@/hooks/useRolesData";
import { KICK_COOLDOWN_MS } from "@/lib/scoreKick";

// Office-less companies used to sit on a golden-angle sunflower: a visibly regular
// pattern ("perfectly distributed", the owner, 2026-08-26). Placement is now a
// deterministic per-company scatter inside the same disc.
const BCN: [number, number] = [2.17, 41.39];

describe("naturalPlace", () => {
  it("is deterministic per company key", () => {
    expect(naturalPlace(BCN, "barcelona|glovo", 40)).toEqual(naturalPlace(BCN, "barcelona|glovo", 40));
  });
  it("gives different companies different points", () => {
    const a = naturalPlace(BCN, "barcelona|glovo", 40);
    const b = naturalPlace(BCN, "barcelona|typeform", 40);
    expect(a).not.toEqual(b);
  });
  it("stays inside the per-city disc", () => {
    const r = discRadiusFor(40);
    for (const k of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const [lng, lat] = naturalPlace(BCN, `barcelona|${k}`, 40);
      const dlat = lat - BCN[1];
      const dlng = (lng - BCN[0]) * Math.cos((BCN[1] * Math.PI) / 180);
      expect(Math.hypot(dlat, dlng)).toBeLessThanOrEqual(r + 1e-9);
    }
  });
  it("is not a regular ring: radii vary between companies", () => {
    const radii = ["a", "b", "c", "d", "e", "f"].map((k) => {
      const [lng, lat] = naturalPlace(BCN, `berlin|${k}`, 40);
      return Math.hypot(lat - BCN[1], (lng - BCN[0]) * Math.cos((BCN[1] * Math.PI) / 180));
    });
    expect(new Set(radii.map((x) => x.toFixed(6))).size).toBeGreaterThan(3);
  });
});

describe("batch re-kick cadence", () => {
  it("is above the server's per-user kick cooldown so every re-kick runs", () => {
    expect(BATCH_REKICK_MS).toBeGreaterThan(KICK_COOLDOWN_MS);
  });
});
