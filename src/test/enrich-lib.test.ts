// Pins the pure helpers of the company-context enrichment batch (Rober 2026-07-06).
// The whole batch is GROUNDED: these parsers only ever return a value that was
// really present in the source (JD JSON, site meta, Wikidata) — else null/dropped.
import { describe, expect, it } from "vitest";
import {
  sanitizeDescription,
  parseEnrichment,
  metaDescription,
  parseWikidataTime,
  linkedinFromHtml,
} from "../../scripts/enrich-lib.mjs";

describe("sanitizeDescription", () => {
  it("collapses whitespace and trims", () => {
    expect(sanitizeDescription("  A   fintech\n platform  ")).toBe("A fintech platform");
  });
  it("rejects too-short / empty", () => {
    expect(sanitizeDescription("short")).toBeNull();
    expect(sanitizeDescription("")).toBeNull();
    expect(sanitizeDescription(null)).toBeNull();
  });
  it("caps long text with an ellipsis", () => {
    const out = sanitizeDescription("x".repeat(400));
    // a 400-char string always sanitizes to a non-null string; narrow so length/endsWith typecheck
    if (out === null) throw new Error("expected a non-null string");
    expect(out.length).toBe(238);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("parseEnrichment", () => {
  it("keeps only valid fields, drops the rest", () => {
    const out = parseEnrichment(
      'noise {"description":"A debt analytics platform for leveraged finance","sector":"Fintech","stage":"Series_C","founded_year":2016} tail',
    );
    expect(out).toEqual({
      description: "A debt analytics platform for leveraged finance",
      sector: "Fintech",
      stage: "series_c",
      founded_year: 2016,
    });
  });
  it("drops a null / out-of-range year and a too-short description", () => {
    const out = parseEnrichment('{"description":"tiny","sector":"AI","founded_year":1200}');
    // "AI" folds onto its canonical industry at the parse boundary (issue #70).
    expect(out).toEqual({ sector: "AI & machine learning" });
  });
  it("drops a sector outside the canonical industry vocabulary (issue #70)", () => {
    // A free-text answer is how one column ended up carrying 54 strings for 28
    // industries. Nothing downstream ever sees an unrecognised one now.
    expect(parseEnrichment('{"sector":"SaaS"}')).toEqual({});
    expect(parseEnrichment('{"sector":"vibes-as-a-service"}')).toEqual({});
    expect(parseEnrichment('{"sector":"Health Tech"}')).toEqual({ sector: "Healthtech" });
  });
  it("returns {} on non-JSON or garbage", () => {
    expect(parseEnrichment("the model refused")).toEqual({});
    expect(parseEnrichment("")).toEqual({});
    expect(parseEnrichment('{bad json,}')).toEqual({});
  });
  it("extracts team_size when stated, trimmed", () => {
    expect(parseEnrichment('{"team_size":" 51-200 "}')).toEqual({ team_size: "51-200" });
    // parseEnrichment's inferred return unions the garbage-path {} with the parsed shape;
    // cast to the real optional-team_size shape to read the field the runtime can produce
    expect((parseEnrichment('{"description":"tiny"}') as { team_size?: string }).team_size).toBeUndefined();
  });
});

describe("linkedinFromHtml", () => {
  it("extracts a company LinkedIn URL from footer markup", () => {
    expect(linkedinFromHtml('<a href="https://www.linkedin.com/company/deliveroo/">LinkedIn</a>')).toBe(
      "https://www.linkedin.com/company/deliveroo",
    );
    expect(linkedinFromHtml('… "https://uk.linkedin.com/company/9fin?trk=x" …')).toBe(
      "https://www.linkedin.com/company/9fin",
    );
  });
  it("ignores personal profiles and returns null when absent", () => {
    expect(linkedinFromHtml('<a href="https://www.linkedin.com/in/some-person">x</a>')).toBeNull();
    expect(linkedinFromHtml("<html>no socials</html>")).toBeNull();
    expect(linkedinFromHtml(null)).toBeNull();
  });
});

describe("metaDescription", () => {
  it("reads og:description (either attribute order)", () => {
    expect(
      metaDescription('<meta property="og:description" content="Grocery delivery, fast">'),
    ).toBe("Grocery delivery, fast");
    expect(
      metaDescription('<meta content="Grocery delivery, fast" property="og:description">'),
    ).toBe("Grocery delivery, fast");
  });
  it("falls back to <meta name=description> and decodes entities", () => {
    expect(
      metaDescription('<meta name="description" content="Tools &amp; data for teams">'),
    ).toBe("Tools & data for teams");
  });
  it("is null when no usable meta is present", () => {
    expect(metaDescription("<html><body>no meta</body></html>")).toBeNull();
    expect(metaDescription(null)).toBeNull();
  });
});

describe("parseWikidataTime", () => {
  it("extracts the year from a P571 time string", () => {
    expect(parseWikidataTime("+2013-00-00T00:00:00Z")).toBe(2013);
    expect(parseWikidataTime("+1998-06-01T00:00:00Z")).toBe(1998);
  });
  it("rejects malformed or out-of-range values", () => {
    expect(parseWikidataTime("2013")).toBeNull();
    expect(parseWikidataTime("+1400-00-00T00:00:00Z")).toBeNull();
    expect(parseWikidataTime(null)).toBeNull();
  });
});
