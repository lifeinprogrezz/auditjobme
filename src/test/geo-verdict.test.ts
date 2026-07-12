// Pins geoVerdict (issue #42) — the geo / work-authorization badge on the /roles
// surface. The load-bearing safety property: NEVER emit a wrong verdict — an
// unstated JD must fall through to 'unverified', never a guessed positive/barrier.
import { describe, expect, it } from "vitest";
import { geoVerdict, type RoleExtraction, type RoleJob } from "@/lib/roles";

function job(extraction: RoleExtraction | null): RoleJob {
  return {
    id: "x",
    company: "Acme",
    title: "Product Manager",
    url: "https://example.com/x",
    location: "Berlin",
    remote: false,
    source: "greenhouse",
    seniority: "pm",
    posted_at: null,
    score: null,
    reason: null,
    city: "Berlin",
    lngLat: null,
    domain: null,
    extraction,
  } as RoleJob;
}

describe("geoVerdict", () => {
  it("reports sponsorship when the JD offers it (card badge)", () => {
    const v = geoVerdict(job({ visa_sponsorship: "offered" }));
    expect(v.kind).toBe("sponsors");
    expect(v.onCard).toBe(true);
  });

  it("offered sponsorship wins even over a US-only geo string", () => {
    expect(geoVerdict(job({ visa_sponsorship: "offered", geo_eligibility: "US only" })).kind).toBe(
      "sponsors",
    );
  });

  it("flags a stated US-only barrier", () => {
    const v = geoVerdict(job({ geo_eligibility: "US only, must be authorized to work in the US" }));
    expect(v.kind).toBe("barrier");
    expect(v.onCard).toBe(true);
  });

  it("reports EU eligibility when the JD states it", () => {
    const v = geoVerdict(job({ geo_eligibility: "Open to candidates across the EU" }));
    expect(v.kind).toBe("eu-eligible");
    expect(v.onCard).toBe(true);
  });

  it("falls through to 'unverified' when nothing is stated (never a wrong verdict)", () => {
    const v = geoVerdict(job(null));
    expect(v.kind).toBe("unverified");
    expect(v.onCard).toBe(false);
    expect(geoVerdict(job({ geo_eligibility: "" })).kind).toBe("unverified");
  });

  it("does not fabricate a barrier from an incidental 'US' mention", () => {
    // A multi-region string mentioning the US is NOT a US-only barrier; the EU
    // signal is present and honest, so it reports EU eligibility, not a barrier.
    expect(geoVerdict(job({ geo_eligibility: "Europe, US, APAC" })).kind).toBe("eu-eligible");
  });
});
