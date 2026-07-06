// Pins companyCityRoles — the /roles pin-click selector (Rober 2026-07-06):
// clicking a company logo pin opens the single role's detail directly, or, when
// the company has several roles in that city, filters the panel list to them.
// The 1-vs-many fork depends on this count, so the filter is locked here.
import { describe, expect, it } from "vitest";
import { companyCityRoles, type RoleJob } from "@/lib/roles";

function job(id: string, company: string, city: string | null): RoleJob {
  return {
    id,
    company,
    title: `${company} PM`,
    url: `https://example.com/${id}`,
    location: null,
    remote: false,
    source: null,
    seniority: null,
    posted_at: null,
    score: null,
    reason: null,
    city,
    lngLat: null,
    domain: null,
  } as RoleJob;
}

describe("companyCityRoles", () => {
  const jobs = [
    job("a", "Prosper", "London"),
    job("b", "Prosper", "London"),
    job("c", "Prosper", "Berlin"),
    job("d", "9fin", "London"),
    job("e", "Solo", "Madrid"),
    job("f", "NoCity", null),
  ];

  it("returns every role for a company in a given city", () => {
    expect(companyCityRoles(jobs, "Prosper", "London").map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("returns exactly one when the company has a single role in that city", () => {
    const out = companyCityRoles(jobs, "Solo", "Madrid");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("e");
  });

  it("matches the company case-insensitively (scraped casing must not split the count)", () => {
    expect(companyCityRoles(jobs, "prosper", "London").map((j) => j.id)).toEqual(["a", "b"]);
    expect(companyCityRoles(jobs, "  PROSPER ", "London").map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("excludes the same company's roles in a different city", () => {
    expect(companyCityRoles(jobs, "Prosper", "Berlin").map((j) => j.id)).toEqual(["c"]);
  });

  it("excludes other companies in the same city", () => {
    expect(companyCityRoles(jobs, "9fin", "London").map((j) => j.id)).toEqual(["d"]);
  });

  it("matches all of a company's roles when city is null (unknown-city pin)", () => {
    const mixed = [job("x", "Wide", "London"), job("y", "Wide", "Berlin"), job("z", "Other", null)];
    expect(companyCityRoles(mixed, "Wide", null).map((j) => j.id)).toEqual(["x", "y"]);
  });

  it("returns empty when nothing matches", () => {
    expect(companyCityRoles(jobs, "Ghost", "London")).toEqual([]);
  });
});
