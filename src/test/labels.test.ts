import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  hashCv,
  cvWordCount,
  formatUploadedDate,
  roleArchetypeOf,
  pickScoringSlice,
  readCvStash,
  writeCvStash,
  clearCvStash,
  CV_STASH_KEY,
  FALLBACK_SECTORS,
  visibleSectorChips,
  filterSectorSearch,
} from "@/lib/labels";
import type { RoleJob } from "@/lib/roles";

// Minimal RoleJob factory — only the fields the label logic reads matter.
function job(partial: Partial<RoleJob> & { id: string; title: string }): RoleJob {
  return {
    company: "Acme",
    url: "https://example.com",
    location: null,
    remote: false,
    source: null,
    seniority: null,
    posted_at: null,
    score: null,
    reason: null,
    city: null,
    lngLat: null,
    domain: null,
    sector: null,
    ...partial,
  } as RoleJob;
}

describe("hashCv", () => {
  it("is deterministic for the same text", () => {
    expect(hashCv("Senior Product Manager, 6y")).toBe(hashCv("Senior Product Manager, 6y"));
  });

  it("ignores leading/trailing whitespace", () => {
    expect(hashCv("  my cv  ")).toBe(hashCv("my cv"));
  });

  it("changes when the content changes", () => {
    expect(hashCv("cv version one")).not.toBe(hashCv("cv version two"));
  });

  it("returns a compact base36 string, empty-safe", () => {
    expect(hashCv("")).toMatch(/^[0-9a-z]+$/);
    expect(typeof hashCv("anything")).toBe("string");
  });
});

describe("cvWordCount", () => {
  it("counts whitespace-separated words", () => {
    expect(cvWordCount("Senior Product Manager, 6 years")).toBe(5);
  });

  it("ignores leading/trailing whitespace", () => {
    expect(cvWordCount("  a  b  c  ")).toBe(3);
  });

  it("returns 0 for empty / whitespace-only / null / undefined", () => {
    expect(cvWordCount("")).toBe(0);
    expect(cvWordCount("   ")).toBe(0);
    expect(cvWordCount(null)).toBe(0);
    expect(cvWordCount(undefined)).toBe(0);
  });
});

describe("formatUploadedDate", () => {
  it("formats an ISO timestamp as day/short-month/year", () => {
    // Midday UTC so the assertion holds regardless of the test runner's local
    // timezone (avoids a date-boundary flake near midnight in either direction).
    expect(formatUploadedDate("2026-07-12T12:00:00.000Z")).toBe("12 Jul 2026");
  });

  it("returns null for null / undefined / empty / malformed input", () => {
    expect(formatUploadedDate(null)).toBeNull();
    expect(formatUploadedDate(undefined)).toBeNull();
    expect(formatUploadedDate("")).toBeNull();
    expect(formatUploadedDate("not a date")).toBeNull();
  });
});

describe("roleArchetypeOf", () => {
  it("maps PM titles to Product", () => {
    expect(roleArchetypeOf("Product Manager")).toBe("Product");
    expect(roleArchetypeOf("Senior Product Manager")).toBe("Product");
    expect(roleArchetypeOf("Head of Product")).toBe("Product");
    expect(roleArchetypeOf("Founding Product Manager")).toBe("Product");
  });

  it("maps other functions from keywords", () => {
    expect(roleArchetypeOf("Growth Manager")).toBe("Growth");
    expect(roleArchetypeOf("Data Scientist")).toBe("Data");
    expect(roleArchetypeOf("Product Designer")).toBe("Design");
    expect(roleArchetypeOf("Software Engineer")).toBe("Engineering");
    expect(roleArchetypeOf("Product Marketing Manager")).toBe("Marketing");
    expect(roleArchetypeOf("Account Executive")).toBe("Sales/BD");
    expect(roleArchetypeOf("Chief of Staff")).toBe("Strategy");
  });

  it("returns null for empty / unclassifiable titles", () => {
    expect(roleArchetypeOf("")).toBeNull();
    expect(roleArchetypeOf(null)).toBeNull();
  });
});

describe("pickScoringSlice", () => {
  const jobs = [
    job({ id: "1", title: "Product Manager", sector: "Fintech" }),
    job({ id: "2", title: "Growth Lead", sector: "Consumer" }),
    job({ id: "3", title: "Data Scientist", sector: "Fintech" }),
    job({ id: "4", title: "Product Manager", sector: null }),
  ];

  it("returns the full list when no labels are set", () => {
    expect(pickScoringSlice(jobs, { roles: [], sectors: [] })).toHaveLength(4);
  });

  it("narrows by role archetype", () => {
    const out = pickScoringSlice(jobs, { roles: ["Product"], sectors: [] });
    expect(out.map((j) => j.id).sort()).toEqual(["1", "4"]);
  });

  it("narrows by sector", () => {
    const out = pickScoringSlice(jobs, { roles: [], sectors: ["Fintech"] });
    expect(out.map((j) => j.id).sort()).toEqual(["1", "3"]);
  });

  it("AND-across role and sector", () => {
    const out = pickScoringSlice(jobs, { roles: ["Product"], sectors: ["Fintech"] });
    expect(out.map((j) => j.id)).toEqual(["1"]);
  });

  it("falls back to the full list when the filter would empty the slice", () => {
    const out = pickScoringSlice(jobs, { roles: ["Design"], sectors: ["Gaming"] });
    expect(out).toHaveLength(4);
  });

  it("excludes rows missing a sector when a sector is required", () => {
    const out = pickScoringSlice(jobs, { roles: ["Product"], sectors: ["Consumer"] });
    expect(out).toHaveLength(4); // no Product+Consumer row → fall back to all
  });
});

describe("visibleSectorChips", () => {
  // 15 sectors, pre-sorted desc by frequency (as sectorOptions arrives from RolesMap).
  const opts = Array.from({ length: 15 }, (_, i) => ({
    value: `Sector${i}`,
    label: `Sector${i}`,
    count: 15 - i,
  }));

  it("falls back to FALLBACK_SECTORS when the catalog is empty", () => {
    expect(visibleSectorChips([], [], 12)).toEqual(FALLBACK_SECTORS);
    expect(visibleSectorChips([], ["Anything"], 12)).toEqual(FALLBACK_SECTORS);
  });

  it("returns only the top N when nothing outside it is selected", () => {
    const out = visibleSectorChips(opts, [], 12);
    expect(out).toHaveLength(12);
    expect(out).toEqual(opts.slice(0, 12).map((o) => o.value));
  });

  it("keeps a selected tail sector visible even though it's outside the top N", () => {
    const out = visibleSectorChips(opts, ["Sector14"], 12);
    expect(out).toContain("Sector14");
    expect(out).toHaveLength(13); // top 12 + the one stranded pick
  });

  it("does not duplicate a selected sector that's already in the top N", () => {
    const out = visibleSectorChips(opts, ["Sector0"], 12);
    expect(out.filter((v) => v === "Sector0")).toHaveLength(1);
    expect(out).toHaveLength(12);
  });

  it("appends multiple stranded selections, order preserved", () => {
    const out = visibleSectorChips(opts, ["Sector14", "Sector13"], 12);
    expect(out.slice(12)).toEqual(["Sector14", "Sector13"]);
  });
});

describe("filterSectorSearch", () => {
  const opts = [
    { value: "Fintech", label: "Fintech", count: 40 },
    { value: "Health", label: "Health", count: 30 },
    { value: "Healthtech", label: "Healthtech", count: 5 },
    { value: "Climate", label: "Climate", count: 3 },
  ];

  it("returns nothing for an empty or whitespace-only query", () => {
    expect(filterSectorSearch(opts, [], "")).toEqual([]);
    expect(filterSectorSearch(opts, [], "   ")).toEqual([]);
  });

  it("matches by label, case-insensitive, substring", () => {
    const out = filterSectorSearch(opts, [], "health");
    expect(out.map((o) => o.value).sort()).toEqual(["Health", "Healthtech"]);
  });

  it("excludes options already in the visible set", () => {
    const out = filterSectorSearch(opts, ["Health"], "health");
    expect(out.map((o) => o.value)).toEqual(["Healthtech"]);
  });

  it("returns nothing when there's no match", () => {
    expect(filterSectorSearch(opts, [], "gaming")).toEqual([]);
  });
});

describe("cv stash", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a valid stash and reports success", () => {
    expect(
      writeCvStash({ cv_text: "hello cv", cv_hash: "abc", target_roles: ["Product"], target_sectors: ["Fintech"] }),
    ).toBe(true);
    expect(readCvStash()).toEqual({
      cv_text: "hello cv",
      cv_hash: "abc",
      target_roles: ["Product"],
      target_sectors: ["Fintech"],
    });
  });

  it("returns false when localStorage rejects the write (private mode / quota)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(
        writeCvStash({ cv_text: "x", cv_hash: "y", target_roles: [], target_sectors: [] }),
      ).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns null when absent", () => {
    expect(readCvStash()).toBeNull();
  });

  it("returns null for a malformed payload", () => {
    localStorage.setItem(CV_STASH_KEY, "{ not json");
    expect(readCvStash()).toBeNull();
  });

  it("returns null when cv_text is empty", () => {
    localStorage.setItem(CV_STASH_KEY, JSON.stringify({ cv_text: "   ", target_roles: [] }));
    expect(readCvStash()).toBeNull();
  });

  it("backfills a missing hash and defaults label arrays", () => {
    localStorage.setItem(CV_STASH_KEY, JSON.stringify({ cv_text: "just text" }));
    const s = readCvStash();
    expect(s?.cv_hash).toBe(hashCv("just text"));
    expect(s?.target_roles).toEqual([]);
    expect(s?.target_sectors).toEqual([]);
  });

  it("clears the stash", () => {
    writeCvStash({ cv_text: "x", cv_hash: "y", target_roles: [], target_sectors: [] });
    clearCvStash();
    expect(readCvStash()).toBeNull();
  });
});
