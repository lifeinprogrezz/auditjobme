// Pins the Join.com connector (scripts/sources/joincom.mjs) against a CAPTURED
// REAL payload. src/test/fixtures/joincom-public-jobs.json holds nine
// PublicJobsList items copied verbatim (the one inline description truncated)
// from six live boards on 2026-08-19 — join (54), cocrafter (121551),
// spotixxcom (176789), pflegia (22808), taurusgroup (5743), motor-ai (5740) and
// omnisent (157757) — stitched into one response document so a single parse
// covers every shape the corpus actually contains: an inline description and a
// null one, ONSITE/HYBRID/REMOTE, remoteType COUNTRY and ANYWHERE, a
// non-European office, a deferred-vertical seat, a seat no family claims, and
// display names that differ from the board slug. The suite never touches the
// network.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  JOIN_GRAPHQL_URL,
  PUBLIC_JOBS_QUERY,
  joinCompanyUrl,
  joinJobsPayload,
  joinJobUrl,
  pickLocation,
  normalizeJoinItem,
  parseJoinJobs,
  isJoinJobsDoc,
  countJoinJobs,
} from "../../scripts/sources/joincom.mjs";

const doc = JSON.parse(
  readFileSync(join(process.cwd(), "src/test/fixtures/joincom-public-jobs.json"), "utf8"),
);
const items = doc.data.publicJobs.items;
const byTitle = (needle: string) =>
  items.find((i: { title: string }) => i.title.includes(needle));

describe("endpoint + request shape", () => {
  it("posts the public candidate API, never the recruiter one", () => {
    // https://join.com/graphql is the recruiter API and answers 401 Unauthenticated.
    expect(JOIN_GRAPHQL_URL).toBe("https://join.com/candidate-api/graphql");
  });

  it("asks for the whole board in one page (no pagination cursor to follow)", () => {
    const payload = joinJobsPayload(15211);
    expect(payload.variables.input.companyId).toBe(15211);
    expect(payload.variables.input.paginationPage).toEqual({ page: 1, pageSize: 200 });
    expect(payload.query).toBe(PUBLIC_JOBS_QUERY);
    expect(payload.query).toContain("PublicJobsList");
  });

  it("resolves a board slug through the by-domain endpoint (its 404 is the liveness guard)", () => {
    expect(joinCompanyUrl({ company: "Superchat", token: "superchat" })).toBe(
      "https://join.com/api/companies/by-domain/superchat",
    );
  });
});

describe("posting url", () => {
  it("uses the returned idParam and never rebuilds it from the numeric id", () => {
    // The idParam prefix is a DIFFERENT number from item.id on most rows.
    const founding = byTitle("Founding Product Manager");
    expect(founding.id).toBe(16279737);
    expect(joinJobUrl(founding)).toBe(
      "https://join.com/companies/cocrafter/16592519-founding-product-manager-y-combinator-startup",
    );
    expect(joinJobUrl(founding)).not.toContain("16279737");
  });

  it("takes the host path from the item's own company domain, not the display name", () => {
    // company.name is "spotixx GmbH"; the board lives at /companies/spotixxcom/.
    expect(joinJobUrl(byTitle("Product Owner"))).toBe(
      "https://join.com/companies/spotixxcom/16575732-product-owner-f-x-m",
    );
  });

  it("yields an empty url when the item names no company or no idParam", () => {
    expect(joinJobUrl({ idParam: "1-x" })).toBe("");
    expect(joinJobUrl({ company: { domain: "acme" } })).toBe("");
    expect(joinJobUrl(null)).toBe("");
  });
});

describe("location handling", () => {
  it("reads the already-English country name straight off the city (no ISO map needed)", () => {
    // The REST detail endpoint localizes this same field ("Deutschland"); GraphQL
    // does not, which is why this connector reads the GraphQL document.
    expect(pickLocation(byTitle("Product Manager"))).toBe("Barcelona, Spain");
    expect(pickLocation(byTitle("Product Owner"))).toBe("Frankfurt am Main, Germany");
  });

  it("falls back to the remote region, then the country, when the item names no city", () => {
    // Defensive: 0 of the 144 rows probed on 2026-08-19 had a null city, but the
    // field is nullable in the schema and a null location would sail through the
    // shared isEU() (which keeps unknown places), so the chain is spelled out.
    expect(
      pickLocation({ city: null, remoteRegion: { defaultCountry: { name: "Portugal" } }, country: { name: "Spain" } }),
    ).toBe("Portugal");
    expect(pickLocation({ city: null, remoteRegion: null, country: { name: "Spain" } })).toBe("Spain");
    expect(pickLocation({ city: null, country: null })).toBeNull();
    expect(pickLocation(null)).toBeNull();
  });

  it("keeps a city with no country readable on its own", () => {
    expect(pickLocation({ city: { cityName: "Berlin", countryName: null } })).toBe("Berlin");
  });
});

describe("normalizeJoinItem", () => {
  const row = normalizeJoinItem(byTitle("Product Manager"), "JOIN");

  it("maps one list item onto the shared jobs row shape", () => {
    expect(row.company).toBe("JOIN");
    expect(row.title).toBe("Product Manager");
    expect(row.url).toBe("https://join.com/companies/join/16550254-product-manager");
    expect(row.location).toBe("Barcelona, Spain");
    expect(row.source).toBe("join");
    expect(row.seniority).toBe("pm");
    expect(row.role_family).toBe("product"); // #34 contract, same classifier scrape.mjs stamps
    expect(row.posted_at).toBe("2026-08-07T12:51:28.983Z");
  });

  it("passes the authoritative 3-way workplaceType through for central normalization", () => {
    // Same contract as the Lever adapter in scrape.mjs (workplace: p.workplaceType).
    expect(row.workplace).toBe("HYBRID");
    expect(normalizeJoinItem(byTitle("Junior Key Account Manager"), "Pflegia").workplace).toBe("REMOTE");
    expect(normalizeJoinItem(byTitle("Founding Product Manager"), "CoCrafter").workplace).toBe("ONSITE");
  });

  it("flags remote from the enum, not from a guess", () => {
    expect(row.remote).toBe(false); // HYBRID
    expect(normalizeJoinItem(byTitle("Junior Key Account Manager"), "Pflegia").remote).toBe(true);
    expect(normalizeJoinItem(byTitle("Founding Product Manager"), "CoCrafter").remote).toBe(false);
  });

  it("carries the inline description when the item has one, stripped of markup", () => {
    expect(row.jd_text).toBeTruthy();
    expect(row.jd_text).not.toMatch(/</);
    expect(row.jd_text.length).toBeLessThanOrEqual(8000);
  });

  it("leaves jd_text null on the rows that carry no description (almost all of them)", () => {
    // 2 of 144 live list rows carried descriptionHtml; scripts/jd-backfill.mjs
    // already routes join.com hosts to its JSON-LD reader for the rest.
    expect(normalizeJoinItem(byTitle("Founding Product Manager"), "CoCrafter").jd_text).toBeNull();
  });

  it("prefers the board display name over the item's own company name", () => {
    // Slug collisions are real (skello -> "La Sfoglia Dorata"), so boards.json wins.
    expect(normalizeJoinItem(byTitle("Product Owner"), "spotixx").company).toBe("spotixx");
    expect(normalizeJoinItem(byTitle("Product Owner"), null).company).toBe("spotixx GmbH");
    expect(normalizeJoinItem({ title: "x" }, null).company).toBeNull();
  });
});

describe("parseJoinJobs", () => {
  const rows = parseJoinJobs(doc, "JOIN");

  it("keeps only European in-scope roles (#34 all-vertical, not PM-only)", () => {
    expect(rows.map((r: { title: string }) => r.title)).toEqual([
      "Product Manager",
      "Founding Product Manager (Y Combinator Startup)",
      "Product Owner (f/x/m)",
      "Junior Key Account Manager (m/w/d)",
      "Senior DevOps Engineer (m/f/d) Hybrid Infrastructure",
      "Group Financial Controller & Risk Manager [Geneva]",
    ]);
  });

  it("stamps role_family on every surviving row", () => {
    expect(rows.map((r: { role_family: string }) => r.role_family)).toEqual([
      "product",
      "product",
      "product",
      "sales",
      "engineering",
      "operations",
    ]);
    expect(rows.every((r: { role_family: string | null }) => r.role_family !== null)).toBe(true);
  });

  it("drops a non-European office even when the title is in scope", () => {
    // "Pre-Sales Engineer [Dubai]" is a sales seat; Dubai is not Europe.
    expect(rows.map((r: { title: string }) => r.title)).not.toContain("Pre-Sales Engineer [Dubai]");
    expect(pickLocation(byTitle("Pre-Sales Engineer"))).toBe("Dubai, United Arab Emirates");
  });

  it("drops the deferred verticals and the seats no family claims", () => {
    const titles = rows.map((r: { title: string }) => r.title);
    expect(titles.some((t: string) => t.includes("Data Scientist"))).toBe(false);
    expect(titles.some((t: string) => t.includes("MECHANICAL ENGINEER"))).toBe(false);
  });

  it("falls back to each item's own company name when the board has no display name", () => {
    expect(parseJoinJobs(doc, null)[0].company).toBe("JOIN");
    expect(parseJoinJobs(doc, null)[1].company).toBe("CoCrafter (YC W24)");
  });

  it("ignores a row that is not ONLINE", () => {
    // Belt and braces: every one of the 144 probed rows was ONLINE — the public
    // API serves no other status — so this can only ever drop something that
    // should not ship.
    const offline = JSON.parse(JSON.stringify(doc));
    offline.data.publicJobs.items[0].status = "OFFLINE";
    expect(parseJoinJobs(offline, "JOIN").map((r: { title: string }) => r.title)).not.toContain(
      "Product Manager",
    );
  });

  it("survives an empty or malformed document instead of throwing", () => {
    expect(parseJoinJobs({ data: { publicJobs: { items: [], pageInfo: { rowCount: 0 } } } }, "X")).toEqual([]);
    expect(parseJoinJobs({}, "X")).toEqual([]);
    expect(parseJoinJobs(null, "X")).toEqual([]);
    expect(parseJoinJobs({ errors: [{ message: "boom" }] }, "X")).toEqual([]);
  });
});

describe("isJoinJobsDoc", () => {
  it("accepts the real document and an empty board", () => {
    expect(isJoinJobsDoc(doc)).toBe(true);
    // An unknown companyId answers 200 with rowCount 0, not an error — which is
    // exactly why the by-domain 404 is the board-liveness guard, not this.
    expect(isJoinJobsDoc({ data: { publicJobs: { items: [], pageInfo: { rowCount: 0 } } } })).toBe(true);
  });

  it("rejects an error response, an HTML page and anything else", () => {
    expect(isJoinJobsDoc({ errors: [{ message: "Cannot query field" }] })).toBe(false);
    expect(isJoinJobsDoc("<html><head><title>429 Too Many Requests</title>")).toBe(false);
    expect(isJoinJobsDoc(null)).toBe(false);
    expect(isJoinJobsDoc({ data: {} })).toBe(false);
  });
});

describe("countJoinJobs", () => {
  it("counts the live openings for the sync-boards probe", () => {
    expect(countJoinJobs(doc)).toBe(9);
    expect(countJoinJobs({ data: { publicJobs: { items: [], pageInfo: { rowCount: 0 } } } })).toBe(0);
    expect(countJoinJobs(null)).toBe(0);
  });
});
