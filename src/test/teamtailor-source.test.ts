// Pins the Teamtailor connector (scripts/sources/teamtailor.mjs) against a CAPTURED
// REAL payload. src/test/fixtures/teamtailor-jobs-feed.json holds five items copied
// verbatim (descriptions truncated) from four live tenants on 2026-07-26 —
// careers.macadam.app, iqm.teamtailor.com, 73strings.teamtailor.com and
// ucademy.teamtailor.com — stitched into one feed document so a single parse covers
// every shape the corpus actually contains. The suite never touches the network.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatPlace,
  pickLocation,
  normalizeTeamtailorItem,
  parseTeamtailorFeed,
  isTeamtailorFeed,
  teamtailorHost,
  teamtailorFeedUrl,
} from "../../scripts/sources/teamtailor.mjs";

const feed = JSON.parse(
  readFileSync(join(process.cwd(), "src/test/fixtures/teamtailor-jobs-feed.json"), "utf8"),
);
const items = feed.items as Array<Record<string, unknown>>;
const byTitle = (t: string) => items.find((i) => i.title === t)!;

describe("board url resolution", () => {
  it("builds the feed url from a subdomain token", () => {
    expect(teamtailorHost({ company: "IQM", token: "iqm" })).toBe("iqm.teamtailor.com");
    expect(teamtailorFeedUrl({ company: "IQM", token: "iqm" })).toBe(
      "https://iqm.teamtailor.com/jobs.json",
    );
  });

  it("uses an explicit host for a custom career domain", () => {
    // Macadam runs Teamtailor on its own domain. Nothing in the hostname says so,
    // which is why boards.json carries `host` instead of `token` for these.
    expect(teamtailorFeedUrl({ company: "Macadam", host: "careers.macadam.app" })).toBe(
      "https://careers.macadam.app/jobs.json",
    );
  });
});

describe("location handling", () => {
  it("translates the country code so the shared Europe filter can read it", () => {
    // The feed emits ISO codes; job-filters.mjs matches country names.
    expect(formatPlace({ address: { addressLocality: "Espoo", addressCountry: "FI" } })).toBe(
      "Espoo, Finland",
    );
    expect(formatPlace({ address: { addressLocality: "København", addressCountry: "DK" } })).toBe(
      "København, Denmark",
    );
  });

  it("ignores addressRegion", () => {
    // Tenants use it as an internal grouping: a Riyadh office tagged "EMEA" would
    // otherwise sail through the Europe filter on that word alone.
    expect(
      formatPlace({
        address: { addressLocality: "Riyadh", addressCountry: "SA", addressRegion: "EMEA" },
      }),
    ).toBe("Riyadh, SA");
  });

  it("prefers the European office on a multi-location posting and dedupes repeats", () => {
    const multi = byTitle("Senior Technical Product Manager") as { _jobposting: { jobLocation: unknown } };
    expect(pickLocation(multi._jobposting.jobLocation)).toBe("Espoo, Finland");
    const dupes = [
      { address: { addressLocality: "Tallinn", addressCountry: "EE" } },
      { address: { addressLocality: "Tallinn", addressCountry: "EE" } },
    ];
    expect(pickLocation(dupes)).toBe("Tallinn, Estonia");
    expect(pickLocation([{ address: { addressLocality: "New York", addressCountry: "US" } }])).toBe(
      "New York, US",
    );
  });

  it("returns null when a posting carries no location at all", () => {
    const noLoc = byTitle("Responsable de Administración Académica Intern");
    expect(normalizeTeamtailorItem(noLoc, "Ucademy").location).toBeNull();
  });
});

describe("normalizeTeamtailorItem", () => {
  const row = normalizeTeamtailorItem(byTitle("SENIOR PRODUCT MANAGER"), "Macadam");

  it("maps the feed item onto the shared jobs row shape", () => {
    expect(row.company).toBe("Macadam");
    expect(row.title).toBe("SENIOR PRODUCT MANAGER");
    expect(row.url).toBe("https://careers.macadam.app/jobs/8096943-senior-product-manager");
    expect(row.location).toBe("Barcelona, Spain");
    expect(row.source).toBe("teamtailor");
    expect(row.seniority).toBe("senior");
    expect(row.remote).toBe(false);
  });

  it("carries the description inline, stripped of markup", () => {
    // Unlike the SmartRecruiters/Workable list endpoints, this feed ships the body.
    expect(row.jd_text).toBeTruthy();
    expect(row.jd_text).not.toMatch(/</);
    expect(row.jd_text!.length).toBeLessThanOrEqual(8000);
  });

  it("normalizes the publish date to an ISO instant", () => {
    expect(row.posted_at).toBe(new Date("2026-07-20T15:51:28+02:00").toISOString());
  });
});

describe("parseTeamtailorFeed", () => {
  const rows: Array<{ title: string; company: string }> = parseTeamtailorFeed(feed, "Fixture Co");

  it("keeps only European Product roles", () => {
    expect(rows.map((r) => r.title)).toEqual([
      "SENIOR PRODUCT MANAGER", // Barcelona
      "Senior Technical Product Manager", // Espoo, kept via the country-code mapping
    ]);
  });

  it("drops the non-European Product role and the engineering seat", () => {
    const titles = rows.map((r) => r.title);
    expect(titles).not.toContain("Senior Data Product Manager"); // New York
    expect(titles).not.toContain("Endpoint Support Engineer");
  });

  it("falls back to the feed's own company name when the board has none", () => {
    expect(parseTeamtailorFeed(feed, null)[0].company).toBe("Macadam");
  });

  it("survives an empty or malformed document instead of throwing", () => {
    expect(parseTeamtailorFeed({ items: [] }, "X")).toEqual([]);
    expect(parseTeamtailorFeed(null, "X")).toEqual([]);
    expect(parseTeamtailorFeed({}, "X")).toEqual([]);
  });
});

describe("isTeamtailorFeed", () => {
  it("accepts the real document", () => {
    expect(isTeamtailorFeed(feed)).toBe(true);
  });

  it("accepts an empty board that still identifies itself", () => {
    expect(
      isTeamtailorFeed({
        version: "https://jsonfeed.org/version/1.1",
        feed_url: "https://acme.teamtailor.com/jobs.json",
        items: [],
      }),
    ).toBe(true);
  });

  it("rejects anything that is not a Teamtailor career feed", () => {
    expect(isTeamtailorFeed(null)).toBe(false);
    expect(isTeamtailorFeed({ items: [] })).toBe(false);
    expect(isTeamtailorFeed({ version: "https://jsonfeed.org/version/1.1", items: [{ title: "x" }] })).toBe(
      false,
    );
  });
});
