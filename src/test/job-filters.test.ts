import { describe, it, expect } from "vitest";
import {
  isPM,
  isEU,
  inferSeniority,
  stripHtml,
  classifyRoleFamily,
  isInScope,
  ROLE_FAMILIES,
  FAMILY_QUERIES,
  FAMILY_SEED_QUERIES,
} from "../../scripts/job-filters.mjs";

describe("isPM", () => {
  it("accepts core product titles", () => {
    expect(isPM("Product Manager")).toBe(true);
    expect(isPM("Senior Product Manager")).toBe(true);
    expect(isPM("Product Owner")).toBe(true);
    expect(isPM("Head of Product")).toBe(true);
    expect(isPM("Founding Product Manager")).toBe(true);
    expect(isPM("Principal Product Manager, Security")).toBe(true);
  });

  it("rejects design / engineering / data / analyst / marketing seats", () => {
    expect(isPM("Lead Product Designer")).toBe(false);
    expect(isPM("Director of Product Design")).toBe(false);
    expect(isPM("Product Engineer")).toBe(false);
    expect(isPM("Senior Software Engineer")).toBe(false);
    expect(isPM("Data Scientist")).toBe(false);
    expect(isPM("Business Analyst")).toBe(false);
    expect(isPM("Marketing Manager")).toBe(false);
  });

  it("rejects unrelated titles and empty input", () => {
    expect(isPM("Account Executive")).toBe(false);
    expect(isPM("")).toBe(false);
    expect(isPM(null)).toBe(false);
  });
});

// The all-vertical classifier (issue #34; vertical set decided 2026-07-26).
describe("classifyRoleFamily", () => {
  it("ships exactly the five decided families", () => {
    expect([...ROLE_FAMILIES].sort()).toEqual([
      "engineering",
      "marketing",
      "operations",
      "product",
      "sales",
    ]);
  });

  it("classifies product seats (unchanged from the PM-only gate)", () => {
    expect(classifyRoleFamily("Product Manager")).toBe("product");
    expect(classifyRoleFamily("Senior Product Owner")).toBe("product");
    expect(classifyRoleFamily("Head of Product")).toBe("product");
    expect(classifyRoleFamily("Growth Product Manager")).toBe("product");
    expect(classifyRoleFamily("Technical Product Manager")).toBe("product");
  });

  it("classifies engineering seats — the old global engineer kill is now family-scoped", () => {
    expect(classifyRoleFamily("Senior Software Engineer")).toBe("engineering");
    expect(classifyRoleFamily("Backend Engineer")).toBe("engineering");
    expect(classifyRoleFamily("Site Reliability Engineer")).toBe("engineering");
    expect(classifyRoleFamily("Engineering Manager")).toBe("engineering");
    expect(classifyRoleFamily("Staff Engineer")).toBe("engineering");
    expect(classifyRoleFamily("Tech Lead")).toBe("engineering");
  });

  it("boundary rule: data / ML / analytics ENGINEER titles are engineering", () => {
    expect(classifyRoleFamily("Data Engineer")).toBe("engineering");
    expect(classifyRoleFamily("Machine Learning Engineer")).toBe("engineering");
    expect(classifyRoleFamily("Analytics Engineer")).toBe("engineering");
  });

  it("classifies sales seats, incl. solutions engineer and revenue operations", () => {
    expect(classifyRoleFamily("Account Executive")).toBe("sales");
    expect(classifyRoleFamily("Sales Development Representative")).toBe("sales");
    expect(classifyRoleFamily("Business Development Manager")).toBe("sales");
    expect(classifyRoleFamily("Solutions Engineer")).toBe("sales");
    expect(classifyRoleFamily("Revenue Operations Manager")).toBe("sales");
    expect(classifyRoleFamily("Partnerships Manager")).toBe("sales");
  });

  it("classifies marketing seats, incl. product marketing", () => {
    expect(classifyRoleFamily("Marketing Manager")).toBe("marketing");
    expect(classifyRoleFamily("Product Marketing Manager")).toBe("marketing");
    expect(classifyRoleFamily("Growth Manager")).toBe("marketing");
    expect(classifyRoleFamily("Demand Generation Lead")).toBe("marketing");
    expect(classifyRoleFamily("SEO Manager")).toBe("marketing");
  });

  it("classifies operations seats (ops + finance + people as ONE family)", () => {
    expect(classifyRoleFamily("Operations Manager")).toBe("operations");
    expect(classifyRoleFamily("Chief of Staff")).toBe("operations");
    expect(classifyRoleFamily("Finance Manager")).toBe("operations");
    expect(classifyRoleFamily("People Operations Specialist")).toBe("operations");
    expect(classifyRoleFamily("Talent Acquisition Partner")).toBe("operations");
    expect(classifyRoleFamily("Recruiter")).toBe("operations");
    expect(classifyRoleFamily("Strategy & Operations Manager")).toBe("operations");
  });

  it("deferred verticals stay out of EVERY family: design and data/AI analyst-scientist seats", () => {
    expect(classifyRoleFamily("Lead Product Designer")).toBe(null);
    expect(classifyRoleFamily("Director of Product Design")).toBe(null);
    expect(classifyRoleFamily("Data Scientist")).toBe(null);
    expect(classifyRoleFamily("Research Scientist")).toBe(null);
    expect(classifyRoleFamily("Data Analyst")).toBe(null);
    expect(classifyRoleFamily("Business Analyst")).toBe(null);
  });

  it("non-software engineering and unclaimed titles are out of scope", () => {
    expect(classifyRoleFamily("Endpoint Support Engineer")).toBe(null);
    expect(classifyRoleFamily("Mechanical Engineer")).toBe(null);
    expect(classifyRoleFamily("Customer Success Manager")).toBe(null);
    expect(classifyRoleFamily("")).toBe(null);
    expect(classifyRoleFamily(null)).toBe(null);
  });

  it("isInScope is the ingest gate over all five families", () => {
    expect(isInScope("Product Manager")).toBe(true);
    expect(isInScope("Backend Engineer")).toBe(true);
    expect(isInScope("Account Executive")).toBe(true);
    expect(isInScope("Product Designer")).toBe(false);
    expect(isInScope("Data Scientist")).toBe(false);
  });

  it("every family carries decided query terms and one seed query", () => {
    for (const f of ROLE_FAMILIES) {
      expect(FAMILY_QUERIES[f as keyof typeof FAMILY_QUERIES].length).toBeGreaterThan(0);
    }
    expect(FAMILY_SEED_QUERIES).toHaveLength(ROLE_FAMILIES.length);
    expect(FAMILY_SEED_QUERIES).toContain("product manager");
    expect(FAMILY_SEED_QUERIES).toContain("software engineer");
  });
});

describe("isEU", () => {
  it("keeps EU / target-city locations", () => {
    expect(isEU("London")).toBe(true);
    expect(isEU("Barcelona, Spain")).toBe(true);
    expect(isEU("Berlin")).toBe(true);
    expect(isEU("EMEA - Remote")).toBe(true);
  });

  it("drops clearly non-EU locations", () => {
    expect(isEU("San Francisco, CA")).toBe(false);
    expect(isEU("New York")).toBe(false);
    expect(isEU("Singapore")).toBe(false);
  });

  it("keeps unknown / empty location (narrowed elsewhere)", () => {
    expect(isEU(null)).toBe(true);
    expect(isEU("")).toBe(true);
  });
});

describe("inferSeniority", () => {
  it("maps titles to the right bucket", () => {
    expect(inferSeniority("Founding Product Manager")).toBe("founding");
    expect(inferSeniority("Principal Product Manager")).toBe("lead");
    expect(inferSeniority("Head of Product")).toBe("lead");
    expect(inferSeniority("Group Product Manager")).toBe("lead");
    expect(inferSeniority("Senior Product Manager")).toBe("senior");
    expect(inferSeniority("Associate Product Manager")).toBe("apm");
    expect(inferSeniority("Product Manager")).toBe("pm");
  });
});

describe("stripHtml", () => {
  it("strips tags + entities and collapses whitespace", () => {
    expect(stripHtml("<p>Hello &amp; welcome</p>")).toBe("Hello welcome");
    expect(stripHtml("<div>  a   b  </div>")).toBe("a b");
    expect(stripHtml("")).toBe("");
    expect(stripHtml(null)).toBe("");
  });
});
