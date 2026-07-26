import { describe, it, expect } from "vitest";
import { sizeBand, sizeBandOrder, filterJobs, freshnessCutoffMs, requiredLanguages, roleFamily, roleSeenMs, workplaceOf, EMPTY_FILTERS, FRESHNESS_WINDOWS, type RoleJob } from "@/lib/roles";

const base: RoleJob = {
  id: "1",
  company: "Acme",
  title: "Product Manager",
  url: "u",
  location: "Berlin",
  remote: false,
  source: null,
  seniority: "pm",
  posted_at: null,
  score: null,
  reason: null,
  city: "Berlin",
  lngLat: null,
  domain: null,
};
const mk = (o: Partial<RoleJob>): RoleJob => ({ ...base, ...o });

describe("sizeBand", () => {
  it("bands every canonical bucket the database can now hold (issue #68 item 6)", () => {
    expect(sizeBand("1-10")).toBe("1–10");
    expect(sizeBand("11-50")).toBe("11–50");
    expect(sizeBand("51-200")).toBe("51–200");
    expect(sizeBand("201-500")).toBe("201–500");
    expect(sizeBand("501-2000")).toBe("500–2k");
    expect(sizeBand("2001+")).toBe("2k+");
  });
  it("still maps the legacy schemes, for artifacts built before the migration", () => {
    expect(sizeBand("1-10")).toBe("1–10");
    expect(sizeBand("<10")).toBe("1–10");
    expect(sizeBand("10-30")).toBe("11–50");
    expect(sizeBand("11-50")).toBe("11–50");
    expect(sizeBand("30-100")).toBe("51–200");
    expect(sizeBand("51-200")).toBe("51–200");
    expect(sizeBand("100-500")).toBe("201–500");
    expect(sizeBand("201-500")).toBe("201–500");
    expect(sizeBand("500+")).toBe("500–2k");
    expect(sizeBand("500-2k")).toBe("500–2k");
    expect(sizeBand("2k+")).toBe("2k+");
  });
  it("returns null for unknown / empty (never fabricates a band)", () => {
    expect(sizeBand(null)).toBeNull();
    expect(sizeBand(undefined)).toBeNull();
    expect(sizeBand("")).toBeNull();
    expect(sizeBand("banana")).toBeNull();
  });
  it("orders bands small→large, 99 for unknown", () => {
    expect(sizeBandOrder("1–10")).toBe(0);
    expect(sizeBandOrder("2k+")).toBe(5);
    expect(sizeBandOrder("nope")).toBe(99);
    expect(sizeBandOrder("51–200")).toBeLessThan(sizeBandOrder("500–2k"));
  });
});

describe("filterJobs", () => {
  const jobs = [
    mk({ id: "a", company: "Acme", city: "Berlin", sector: "Fintech", headcount: "51-200" }),
    mk({ id: "b", company: "Beta", city: "London", sector: "Healthtech", headcount: "2k+" }),
    mk({ id: "c", company: "Gamma", city: null, sector: null, headcount: null }),
  ];

  it("empty filters return everything — missing-data rows included", () => {
    expect(filterJobs(jobs, EMPTY_FILTERS)).toHaveLength(3);
  });
  it("city filter keeps matches and drops null-city rows", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, cities: ["Berlin"] }).map((j) => j.id)).toEqual(["a"]);
  });
  it("sector filter drops null-sector rows", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, sectors: ["Healthtech"] }).map((j) => j.id)).toEqual(["b"]);
  });
  it("size filter matches by canonical band and drops null-headcount rows", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, sizes: ["51–200"] }).map((j) => j.id)).toEqual(["a"]);
  });
  it("dimensions are AND-across (city AND sector must both hold)", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, cities: ["Berlin"], sectors: ["Healthtech"] })).toHaveLength(0);
  });
  it("free-text query matches company + title only, NOT city", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, query: "beta" }).map((j) => j.id)).toEqual(["b"]);
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, query: "berlin" })).toHaveLength(0);
  });
});

describe("workplaceOf", () => {
  it("workplace column wins over extraction and the remote flag", () => {
    expect(workplaceOf(mk({ workplace: "hybrid", remote: true }))).toBe("hybrid");
    expect(workplaceOf(mk({ workplace: "onsite", extraction: { remote_policy: "remote" } }))).toBe("onsite");
  });
  it("falls back to extraction.remote_policy, then the remote flag, then null", () => {
    expect(workplaceOf(mk({ extraction: { remote_policy: "hybrid" } }))).toBe("hybrid");
    expect(workplaceOf(mk({ remote: true }))).toBe("remote");
    expect(workplaceOf(mk({}))).toBeNull();
  });
});

describe("filterJobs — Workplace discovery facet", () => {
  const jobs = [
    mk({ id: "r", workplace: "remote" }),
    mk({ id: "h", extraction: { remote_policy: "hybrid" } }),
    mk({ id: "o", workplace: "onsite" }),
    mk({ id: "u" }), // unknown
  ];
  it("no selection → everything shows, unknowns included", () => {
    expect(filterJobs(jobs, EMPTY_FILTERS)).toHaveLength(4);
  });
  it("selecting a mode shows ONLY known matches (unknown hides — discovery semantics)", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, workplaces: ["hybrid"] }).map((j) => j.id)).toEqual(["h"]);
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, workplaces: ["remote", "onsite"] }).map((j) => j.id)).toEqual(["r", "o"]);
  });
  it("fixtures without a workplaces key still filter (optional field)", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, cities: ["Berlin"] })).toHaveLength(4);
  });
});

describe("roleFamily", () => {
  it("falls back to Product Manager while the pipeline is PM-gated (null / absent)", () => {
    expect(roleFamily(mk({}))).toBe("Product Manager");
    expect(roleFamily(mk({ role_family: null }))).toBe("Product Manager");
  });
  it("a written role_family wins over the fallback", () => {
    expect(roleFamily(mk({ role_family: "Data" }))).toBe("Data");
  });
});

describe("filterJobs — roles facet", () => {
  const jobs = [mk({ id: "a" }), mk({ id: "b", role_family: "Data" })];
  it("empty selection shows the full catalog", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, roles: [] })).toHaveLength(2);
  });
  it("selecting Product Manager matches null-role_family rows via the fallback", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, roles: ["Product Manager"] }).map((j) => j.id)).toEqual(["a"]);
  });
  it("selecting a written family matches only it (OR-within)", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, roles: ["Data"] }).map((j) => j.id)).toEqual(["b"]);
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, roles: ["Data", "Product Manager"] })).toHaveLength(2);
  });
  it("ANDs across facets (roles + cities)", () => {
    const mix = [mk({ id: "a", city: "Berlin" }), mk({ id: "b", city: "Paris", role_family: "Data" })];
    expect(filterJobs(mix, { ...EMPTY_FILTERS, roles: ["Data"], cities: ["Berlin"] })).toHaveLength(0);
  });
  it("fixtures without a roles key still filter (optional field)", () => {
    expect(filterJobs(jobs, EMPTY_FILTERS)).toHaveLength(2);
  });
});

describe("requiredLanguages", () => {
  it("drops English (implicit) + blanks, keeps real non-English requirements", () => {
    expect(requiredLanguages(mk({ extraction: { languages_required: ["German", "English", " "] } }))).toEqual(["German"]);
    expect(requiredLanguages(mk({ extraction: { languages_required: ["English"] } }))).toEqual([]);
    expect(requiredLanguages(mk({ extraction: null }))).toEqual([]);
    expect(requiredLanguages(mk({}))).toEqual([]);
  });
});

describe("filterJobs — Language discovery facet", () => {
  const jobs = [
    mk({ id: "en", extraction: null }), // English-only, no wall
    mk({ id: "de", extraction: { languages_required: ["German"] } }),
    mk({ id: "deen", extraction: { languages_required: ["German", "English"] } }), // English implicit
    mk({ id: "denl", extraction: { languages_required: ["German", "Dutch"] } }),
    mk({ id: "fr", extraction: { languages_required: ["French"] } }),
  ];

  it("no language selected → everything shows (fail-open)", () => {
    expect(filterJobs(jobs, EMPTY_FILTERS)).toHaveLength(5);
  });
  it("selecting German narrows to ONLY roles that wall on German (English-only hidden)", () => {
    const got = filterJobs(jobs, { ...EMPTY_FILTERS, languages: ["German"] }).map((j) => j.id);
    expect(got).toEqual(["de", "deen", "denl"]); // every German-walled role, and only those
    expect(got).not.toContain("en"); // no wall → hidden while a language is selected
    expect(got).not.toContain("fr"); // French wall, German not among its languages
  });
  it("multi-select is a union (German OR French)", () => {
    const got = filterJobs(jobs, { ...EMPTY_FILTERS, languages: ["German", "French"] }).map((j) => j.id);
    expect(got).toEqual(["de", "deen", "denl", "fr"]); // any role walling on German or French
  });
});

// ── Issue #73 slice 3: the Freshness facet ────────────────────────────────────
// FILTER ONLY. We measured age against 10,921 rows of the personal engine's golden
// scoring data on 2026-07-26: freshness does NOT predict match quality (the learned
// weights are non-monotonic), so it must never tilt the ranking — only the view.
const DAY = 86_400_000;
const NOW = Date.parse("2026-07-26T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

describe("roleSeenMs", () => {
  it("prefers first_seen_at, falls back to posted_at, then unknown", () => {
    expect(roleSeenMs({ first_seen_at: daysAgo(2), posted_at: daysAgo(90) })).toBe(Date.parse(daysAgo(2)));
    expect(roleSeenMs({ first_seen_at: null, posted_at: daysAgo(5) })).toBe(Date.parse(daysAgo(5)));
    expect(roleSeenMs({ first_seen_at: null, posted_at: null })).toBe(0);
  });
});

describe("freshnessCutoffMs", () => {
  it("returns null when nothing is selected (no age filter at all)", () => {
    expect(freshnessCutoffMs([], NOW)).toBeNull();
    expect(freshnessCutoffMs(undefined, NOW)).toBeNull();
    expect(freshnessCutoffMs(["nonsense"], NOW)).toBeNull();
  });
  it("a multi-select is a UNION — the widest selected window wins", () => {
    expect(freshnessCutoffMs(["7"], NOW)).toBe(NOW - 7 * DAY);
    expect(freshnessCutoffMs(["7", "28"], NOW)).toBe(NOW - 28 * DAY);
  });
  it("offers exactly the 7 / 14 / 28-day ladder", () => {
    expect(FRESHNESS_WINDOWS.map((w) => w.days)).toEqual([7, 14, 28]);
  });
});

describe("filterJobs — Freshness discovery facet", () => {
  const jobs = [
    mk({ id: "fresh", first_seen_at: daysAgo(2), posted_at: null }),
    mk({ id: "mid", first_seen_at: daysAgo(10), posted_at: null }),
    mk({ id: "old", first_seen_at: daysAgo(40), posted_at: null }),
    // posted_at is nullable and first_seen_at is on every real row; this is the
    // pre-#73 dataplane-artifact shape, where the fallback carries the date.
    mk({ id: "fallback", first_seen_at: null, posted_at: daysAgo(3) }),
    mk({ id: "undated", first_seen_at: null, posted_at: null }),
  ];

  it("no window selected → everything shows, undated rows included", () => {
    expect(filterJobs(jobs, EMPTY_FILTERS, NOW)).toHaveLength(5);
  });
  it("7 days keeps only roles seen inside the window", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, freshness: ["7"] }, NOW).map((j) => j.id)).toEqual([
      "fresh",
      "fallback",
    ]);
  });
  it("28 days widens it; a 40-day-old role still fails", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, freshness: ["28"] }, NOW).map((j) => j.id)).toEqual([
      "fresh",
      "mid",
      "fallback",
    ]);
  });
  it("an UNDATED role hides while a window is active — we never fabricate it as fresh", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, freshness: ["28"] }, NOW).map((j) => j.id)).not.toContain("undated");
  });
});

// ── Issue #73 slice 5: the UK sponsor-licence facet ───────────────────────────
describe("filterJobs — UK sponsor discovery facet", () => {
  const jobs = [
    mk({ id: "lic", ukSponsorStatus: "licensed" }),
    mk({ id: "un", ukSponsorStatus: "unmatched" }),
    mk({ id: "unchecked", ukSponsorStatus: null }),
  ];

  it("no status selected → everything shows (fail-open)", () => {
    expect(filterJobs(jobs, EMPTY_FILTERS, NOW)).toHaveLength(3);
  });
  it("selecting 'licensed' keeps only companies on the Home Office register", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, sponsors: ["licensed"] }, NOW).map((j) => j.id)).toEqual(["lic"]);
  });
  it("an UNCHECKED company hides while a status is active — silence is not evidence", () => {
    const got = filterJobs(jobs, { ...EMPTY_FILTERS, sponsors: ["licensed", "unmatched"] }, NOW).map((j) => j.id);
    expect(got).toEqual(["lic", "un"]);
    expect(got).not.toContain("unchecked");
  });
});
