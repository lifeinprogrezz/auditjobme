import { describe, it, expect } from "vitest";
import { sizeBand, sizeBandOrder, filterJobs, EMPTY_FILTERS, type RoleJob } from "@/lib/roles";

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
  it("maps both inconsistent source schemes into one canonical ladder", () => {
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
