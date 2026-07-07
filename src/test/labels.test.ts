import { describe, it, expect, beforeEach } from "vitest";
import {
  hashCv,
  roleArchetypeOf,
  pickScoringSlice,
  readCvStash,
  writeCvStash,
  clearCvStash,
  CV_STASH_KEY,
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

describe("cv stash", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a valid stash", () => {
    writeCvStash({ cv_text: "hello cv", cv_hash: "abc", target_roles: ["Product"], target_sectors: ["Fintech"] });
    expect(readCvStash()).toEqual({
      cv_text: "hello cv",
      cv_hash: "abc",
      target_roles: ["Product"],
      target_sectors: ["Fintech"],
    });
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
