import { describe, it, expect } from "vitest";
import { isPM, isEU, inferSeniority, stripHtml } from "../../scripts/job-filters.mjs";

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
