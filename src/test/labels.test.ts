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
  visibleSectorChips,
  filterSectorSearch,
  ROLE_FAMILIES,
  ROLE_FAMILY_OPTIONS,
  archetypeToFamily,
  isRoleFamily,
  normalizeTargetRoles,
  roleMatchesTargets,
} from "@/lib/labels";
import { ROLE_FAMILY_LABELS } from "@/lib/scorePrompt";
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

// ── The ONE role vocabulary (issue #70) ──────────────────────────────────────
// Three vocabularies used to be live at once — ten Title-Case archetypes in the
// pickers, five lowercase families in the database, and the raw family string in
// the /roles facet. A user could not express the same idea on two surfaces.
describe("the role vocabulary", () => {
  it("is the five jobs.role_family values, in a fixed order", () => {
    expect([...ROLE_FAMILIES]).toEqual([
      "product",
      "engineering",
      "sales",
      "marketing",
      "operations",
    ]);
  });

  it("takes its display names from the scorer's map rather than inventing a fourth", () => {
    for (const o of ROLE_FAMILY_OPTIONS) expect(o.label).toBe(ROLE_FAMILY_LABELS[o.value]);
    expect(ROLE_FAMILY_OPTIONS.map((o) => o.value)).toEqual([...ROLE_FAMILIES]);
  });

  it("stores the value the catalog uses, not the label the user reads", () => {
    // The facet compares the chip value against jobs.role_family, so a chip
    // labelled "Sales" must still carry "sales".
    expect(ROLE_FAMILY_OPTIONS.find((o) => o.label === "Sales")?.value).toBe("sales");
    expect(isRoleFamily("sales")).toBe(true);
    expect(isRoleFamily("Sales")).toBe(false);
  });
});

describe("archetypeToFamily", () => {
  it("passes a current family through", () => {
    for (const f of ROLE_FAMILIES) expect(archetypeToFamily(f)).toBe(f);
  });

  it("maps the five archetypes that already had a family", () => {
    expect(archetypeToFamily("Product")).toBe("product");
    expect(archetypeToFamily("Engineering")).toBe("engineering");
    expect(archetypeToFamily("Marketing")).toBe("marketing");
    expect(archetypeToFamily("Sales/BD")).toBe("sales");
    expect(archetypeToFamily("Operations")).toBe("operations");
  });

  it("places the five that had NO family — the real breakage", () => {
    // Under a naive swap a stored "Growth" would have matched nothing, emptied
    // that user's scoring slice and put permanent "Not scored" copy on every
    // card. Growth and Data reached 286 and 522 live rows; not rounding errors.
    expect(archetypeToFamily("Growth")).toBe("marketing");
    expect(archetypeToFamily("Data")).toBe("engineering");
    expect(archetypeToFamily("Strategy")).toBe("operations");
    expect(archetypeToFamily("Founding")).toBe("product");
    expect(archetypeToFamily("Design")).toBeNull(); // a deferred vertical, no home
  });

  it("understands the dev fixture's stray 'Product Manager'", () => {
    // It belonged to none of the three old vocabularies and matched nothing.
    expect(archetypeToFamily("Product Manager")).toBe("product");
  });

  it("returns null for anything else", () => {
    expect(archetypeToFamily("Astronaut")).toBeNull();
    expect(archetypeToFamily("")).toBeNull();
    expect(archetypeToFamily(null)).toBeNull();
  });
});

describe("normalizeTargetRoles", () => {
  it("translates a stored profile that predates the vocabulary", () => {
    expect(normalizeTargetRoles(["Product", "Growth"])).toEqual(["product", "marketing"]);
  });

  it("dedupes two archetypes that land on one family", () => {
    expect(normalizeTargetRoles(["Marketing", "Growth"])).toEqual(["marketing"]);
  });

  it("is idempotent, so re-reading an already-migrated profile is a no-op", () => {
    expect(normalizeTargetRoles(["product", "sales"])).toEqual(["product", "sales"]);
  });

  it("does not strand a user whose only pick has no home", () => {
    // An empty array reads as "no role preference" everywhere, which shows the
    // whole catalog — not an empty scoring slice and a permanently unscored map.
    expect(normalizeTargetRoles(["Design"])).toEqual([]);
    expect(normalizeTargetRoles(null)).toEqual([]);
  });
});

describe("roleMatchesTargets", () => {
  it("matches on jobs.role_family first — the label the catalog carries", () => {
    const j = { title: "Enterprise Account Director", role_family: "sales" };
    expect(roleMatchesTargets(j, ["sales"])).toBe(true);
    expect(roleMatchesTargets(j, ["product"])).toBe(false);
  });

  it("recovers rows the title regex misses — the whole point of leading with family", () => {
    // Measured 2026-08-19: the title regex finds 65% of live `sales` rows and 48%
    // of live `operations` rows, and 607 live rows match no archetype at all.
    // The nightly digest used to run on that regex alone.
    expect(roleMatchesTargets({ title: "Client Partner", role_family: "sales" }, ["sales"])).toBe(
      true,
    );
  });

  it("falls back to the title when the catalog left the row unlabelled", () => {
    expect(roleMatchesTargets({ title: "Product Manager", role_family: null }, ["product"])).toBe(
      true,
    );
    expect(roleMatchesTargets({ title: "Software Engineer", role_family: null }, ["product"])).toBe(
      false,
    );
  });

  it("honours a legacy archetype still sitting in a profile or a stale CV stash", () => {
    // A sign-up begun before the deploy and finished after it writes the old value.
    expect(roleMatchesTargets({ title: "Growth Manager", role_family: "marketing" }, ["Growth"])).toBe(
      true,
    );
    expect(roleMatchesTargets({ title: "Brand Manager", role_family: "marketing" }, ["Growth"])).toBe(
      true, // via Growth → marketing; widened, never narrowed
    );
    expect(roleMatchesTargets({ title: "Backend Engineer", role_family: "engineering" }, ["Data"])).toBe(
      true,
    );
  });

  it("an empty selection matches everything", () => {
    expect(roleMatchesTargets({ title: "anything", role_family: null }, [])).toBe(true);
  });
});

describe("pickScoringSlice", () => {
  const jobs = [
    job({ id: "1", title: "Product Manager", role_family: "product", sector: "Fintech" }),
    job({ id: "2", title: "Growth Lead", role_family: "marketing", sector: "Consumer" }),
    job({ id: "3", title: "Data Scientist", role_family: null, sector: "Fintech" }),
    job({ id: "4", title: "Product Manager", role_family: "product", sector: null }),
    // The recall case: a sales seat no title regex claims.
    job({ id: "5", title: "Client Partner", role_family: "sales", sector: "Fintech" }),
  ];

  it("returns the full list when no labels are set", () => {
    expect(pickScoringSlice(jobs, { roles: [], sectors: [] })).toHaveLength(5);
  });

  it("narrows by role family", () => {
    const out = pickScoringSlice(jobs, { roles: ["product"], sectors: [] });
    expect(out.map((j) => j.id).sort()).toEqual(["1", "4"]);
  });

  it("uses the SAME role rule as the paid backlog prefilter", () => {
    // These two workers disagreed: the nightly matched titles only, so a "Client
    // Partner" filed as sales was invisible to a Sales selection here while the
    // backlog worker scored it. One rule now (roleMatchesTargets).
    expect(pickScoringSlice(jobs, { roles: ["sales"], sectors: [] }).map((j) => j.id)).toEqual(["5"]);
  });

  it("narrows by sector", () => {
    const out = pickScoringSlice(jobs, { roles: [], sectors: ["Fintech"] });
    expect(out.map((j) => j.id).sort()).toEqual(["1", "3", "5"]);
  });

  it("AND-across role and sector", () => {
    const out = pickScoringSlice(jobs, { roles: ["product"], sectors: ["Fintech"] });
    expect(out.map((j) => j.id)).toEqual(["1"]);
  });

  it("falls back to the full list when the filter would empty the slice", () => {
    const out = pickScoringSlice(jobs, { roles: ["operations"], sectors: ["Gaming"] });
    expect(out).toHaveLength(5);
  });

  it("excludes rows missing a sector when a sector is required", () => {
    const out = pickScoringSlice(jobs, { roles: ["product"], sectors: ["Consumer"] });
    expect(out).toHaveLength(5); // no product+Consumer row → fall back to all
  });
});

describe("visibleSectorChips", () => {
  // 15 sectors, pre-sorted desc by frequency (as sectorOptions arrives from RolesMap).
  const opts = Array.from({ length: 15 }, (_, i) => ({
    value: `Sector${i}`,
    label: `Sector${i}`,
    count: 15 - i,
  }));

  it("offers NOTHING when the catalog is empty (issue #70)", () => {
    // It used to fall back to a hardcoded FALLBACK_SECTORS list, eight of whose
    // twelve entries matched zero live roles. A chip that can only return an
    // empty page is worse than no chip: the user reads it as "no jobs for me".
    expect(visibleSectorChips([], [], 12)).toEqual([]);
    expect(visibleSectorChips([], ["Anything"], 12)).toEqual([]);
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
