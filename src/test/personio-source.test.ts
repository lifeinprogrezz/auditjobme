// Pins the Personio connector (scripts/sources/personio.mjs) against a CAPTURED
// REAL payload. src/test/fixtures/personio-jobs-feed.xml holds four positions
// copied verbatim (descriptions truncated) from two live tenants on 2026-08-11 —
// 1komma5grad.jobs.personio.de and personio.jobs.personio.de — stitched into one
// feed document so a single parse covers every shape the corpus actually
// contains. The suite never touches the network.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EU_CITY_COUNTRIES,
  formatOffice,
  pickLocation,
  parsePosition,
  normalizePersonioPosition,
  parsePersonioXml,
  isPersonioFeed,
  countPersonioPositions,
  personioHost,
  personioFeedUrl,
} from "../../scripts/sources/personio.mjs";

const xml = readFileSync(join(process.cwd(), "src/test/fixtures/personio-jobs-feed.xml"), "utf8");
const HOST = "1komma5grad.jobs.personio.de";

describe("board url resolution", () => {
  it("builds the feed url from a tenant token (.de is canonical — the .com mirror serves the same document)", () => {
    expect(personioHost({ company: "Vytal", token: "vytal" })).toBe("vytal.jobs.personio.de");
    expect(personioFeedUrl({ company: "Vytal", token: "vytal" })).toBe(
      "https://vytal.jobs.personio.de/xml",
    );
  });

  it("uses an explicit host when one is given", () => {
    expect(personioFeedUrl({ company: "Accure", host: "accure.jobs.personio.com" })).toBe(
      "https://accure.jobs.personio.com/xml",
    );
  });
});

describe("location handling", () => {
  it("translates a bare city into the shared Europe filter's vocabulary, native spellings included", () => {
    // Personio emits city names with NO country; job-filters.mjs matches countries.
    expect(formatOffice("Hamburg")).toBe("Hamburg, Germany");
    expect(formatOffice("München")).toBe("München, Germany");
    expect(formatOffice("Wien")).toBe("Wien, Austria");
  });

  it("passes an unmapped long-tail town through untouched (it falls out of the filter, not silently rewritten)", () => {
    expect(formatOffice("Besigheim")).toBe("Besigheim");
  });

  it("treats a Remote marker as no place at all", () => {
    expect(formatOffice("Remote")).toBeNull();
    expect(formatOffice("Berlin (Remote)")).toBe("Berlin, Germany");
  });

  it("prefers the first European office on a multi-office posting", () => {
    // Real shape: the Platform Engineering role lists Remote first, then
    // Hamburg/Berlin/München — the concrete European office wins.
    expect(pickLocation(["Remote", "Hamburg", "Berlin", "München"])).toBe("Hamburg, Germany");
    expect(pickLocation(["Remote"])).toBeNull();
    expect(pickLocation([])).toBeNull();
  });

  it("only maps cities whose country the shared filter can already read", () => {
    // Widening what counts as Europe belongs in job-filters, not this map.
    for (const country of new Set(Object.values(EU_CITY_COUNTRIES))) {
      expect(
        [
          "Germany", "Austria", "Switzerland", "Netherlands", "France", "Spain",
          "Portugal", "Italy", "United Kingdom", "Ireland", "Belgium", "Sweden",
          "Denmark", "Norway", "Finland", "Poland", "Czechia", "Romania",
          "Bulgaria", "Greece", "Estonia", "Lithuania",
        ],
      ).toContain(country);
    }
  });
});

describe("parsePosition + normalizePersonioPosition", () => {
  const blocks = [...xml.matchAll(/<position>([\s\S]*?)<\/position>/g)].map((m) => m[1]);
  const smartMetering = blocks
    .map((b) => parsePosition(b))
    .find((p) => p.name.includes("Smart Metering"))!;
  const row = normalizePersonioPosition(smartMetering, "1KOMMA5°", HOST);

  it("maps the feed position onto the shared jobs row shape", () => {
    expect(row.company).toBe("1KOMMA5°");
    expect(row.title).toBe("(Senior) Product Manager Smart Metering & Steering (m/f/d)"); // &amp; decoded
    expect(row.url).toBe(`https://${HOST}/job/2659159`);
    expect(row.location).toBe("Hamburg, Germany");
    expect(row.source).toBe("personio");
    expect(row.seniority).toBe("senior");
    expect(row.remote).toBe(true); // "Remote" is among the additional offices
  });

  it("never mistakes a jobDescriptions section heading for the position title", () => {
    // <jobDescriptions><jobDescription><name>1KOMMA5°</name>… is cut out first.
    const tpm = blocks.map((b) => parsePosition(b)).find((p) => p.id === "2709885")!;
    expect(tpm.name).toBe("(Lead/Senior) Technical Product Manager - Platform Engineering (m/f/d)");
  });

  it("carries the description inline, stripped of markup", () => {
    // Unlike the SmartRecruiters/Workable list endpoints, this feed ships the body.
    expect(row.jd_text).toBeTruthy();
    expect(row.jd_text!).not.toMatch(/</);
    expect(row.jd_text!.length).toBeLessThanOrEqual(8000);
  });

  it("normalizes the createdAt date to an ISO instant", () => {
    expect(row.posted_at).toBe(new Date("2026-06-05T09:23:32+00:00").toISOString());
  });

  it("yields null jd_text for a position whose jobDescriptions block is empty", () => {
    const swe = blocks.map((b) => parsePosition(b)).find((p) => p.name.startsWith("Staff Software"))!;
    expect(normalizePersonioPosition(swe, "Personio", "personio.jobs.personio.de").jd_text).toBeNull();
  });
});

describe("parsePersonioXml", () => {
  const rows = parsePersonioXml(xml, "1KOMMA5°", HOST);

  it("keeps only European in-scope roles (#34 all-vertical: engineering now included)", () => {
    expect(rows.map((r) => r.title)).toEqual([
      "(Senior) Product Manager Smart Metering & Steering (m/f/d)", // Hamburg, via the city map
      "Staff Software Engineer, Data Platform", // engineering family — in scope since #34
    ]);
  });

  it("drops out-of-scope seats: trade roles and ambiguous product×engineering titles", () => {
    const all = [...xml.matchAll(/<position>/g)];
    expect(all.length).toBe(4);
    const titles = rows.map((r) => r.title);
    // Non-software trade role — no family claims it.
    expect(titles).not.toContain("Elektriker / Elektroniker Energie- und Gebäudetechnik (m/w/d) - Photovoltaik, Wärmepumpen & Energiesysteme - 1KOMMA5° Düsseldorf");
    // Carries BOTH product-manager and engineering vocabulary: the product family
    // rejects it (family-scoped negative) and the engineering family refuses PM_RE
    // titles, so it stays out — same reach as the old global NEG_RE.
    expect(titles).not.toContain("(Lead/Senior) Technical Product Manager - Platform Engineering (m/f/d)");
  });

  it("keeps a non-European office out of the pool", () => {
    const nyc = normalizePersonioPosition(
      parsePosition("<id>1</id><name>Product Manager</name><office>New York</office><jobDescriptions></jobDescriptions>"),
      "Acme",
      "acme.jobs.personio.de",
    );
    expect(nyc.location).toBe("New York");
    expect(
      parsePersonioXml(
        "<workzag-jobs><position><id>1</id><name>Product Manager</name><office>New York</office></position></workzag-jobs>",
        "Acme",
        "acme.jobs.personio.de",
      ),
    ).toEqual([]);
  });

  it("falls back to the position's own subcompany when the board has no name", () => {
    expect(parsePersonioXml(xml, null, HOST)[0].company).toBe("Heartbeat AI GmbH");
  });

  it("survives an empty or malformed document instead of throwing", () => {
    expect(parsePersonioXml("", "X", "x.jobs.personio.de")).toEqual([]);
    expect(parsePersonioXml(null, "X", "x.jobs.personio.de")).toEqual([]);
    expect(parsePersonioXml("<workzag-jobs>\n\n</workzag-jobs>", "X", "x.jobs.personio.de")).toEqual([]);
    expect(parsePersonioXml("not xml at all", "X", "x.jobs.personio.de")).toEqual([]);
  });
});

describe("isPersonioFeed", () => {
  it("accepts the real document and an empty board", () => {
    expect(isPersonioFeed(xml)).toBe(true);
    expect(isPersonioFeed('<?xml version="1.0" encoding="UTF-8"?>\n<workzag-jobs>\n</workzag-jobs>')).toBe(true);
  });

  it("rejects anything that is not a Personio /xml feed", () => {
    expect(isPersonioFeed(null)).toBe(false);
    expect(isPersonioFeed("<!DOCTYPE html><html><body>404</body></html>")).toBe(false);
    expect(isPersonioFeed('{"items":[]}')).toBe(false);
  });
});

describe("countPersonioPositions", () => {
  it("counts the position blocks for the sync-boards liveness probe", () => {
    expect(countPersonioPositions(xml)).toBe(4);
    expect(countPersonioPositions("<workzag-jobs></workzag-jobs>")).toBe(0);
  });
});
