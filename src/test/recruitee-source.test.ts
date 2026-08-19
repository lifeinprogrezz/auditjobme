// Pins the Recruitee connector (scripts/sources/recruitee.mjs) against a CAPTURED
// REAL payload. src/test/fixtures/recruitee-offers.json holds seven offers copied
// verbatim (the two HTML bodies truncated, and the connector-irrelevant
// `translations` / `open_questions` / `dynamic_fields` blobs dropped) from four
// live tenants on 2026-08-19 — sequra, matera, droppie and careers.tether.io —
// stitched into one document so a single parse covers every shape the corpus
// actually contains: a Spanish office, a German office described in FRENCH, a
// Dutch remote placeholder, a nine-office worldwide posting, a null
// `requirements`, an out-of-scope seat and a non-European one. The suite never
// touches the network.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatPlace,
  pickLocation,
  normalizeRecruiteeOffer,
  parseRecruiteeOffers,
  isRecruiteeFeed,
  recruiteeHost,
  recruiteeFeedUrl,
} from "../../scripts/sources/recruitee.mjs";

const doc = JSON.parse(
  readFileSync(join(process.cwd(), "src/test/fixtures/recruitee-offers.json"), "utf8"),
);
const offerById = (id: number) => doc.offers.find((o: { id: number }) => o.id === id);

const SEQURA_PM = 2525660; // Senior Product Manager — Barcelona
const SEQURA_DESIGN = 2707819; // Senior Motion & Graphic Designer — design is deferred (#34)
const MATERA_PM = 2648274; // Product Manager (m/w/d) — Berlin, country rendered "Allemagne"
const DROPPIE_BD = 2633768; // Business Development Stagiair — "Werken op afstand"
const DROPPIE_OPEN = 2244361; // Open Sollicitatie — `requirements` is null
const TETHER_WALLETS = 2520481; // Backend Engineer - Wallets — 9 offices, top-level Abu Dhabi
const TETHER_CAIRO = 2714625; // Frontend Software Engineer — Cairo, non-European

describe("board url resolution", () => {
  it("builds the endpoint from a tenant token", () => {
    expect(recruiteeHost({ company: "seQura", token: "sequra" })).toBe("sequra.recruitee.com");
    expect(recruiteeFeedUrl({ company: "seQura", token: "sequra" })).toBe(
      "https://sequra.recruitee.com/api/offers/",
    );
  });

  it("uses an explicit custom career domain when one is given", () => {
    expect(recruiteeFeedUrl({ company: "Tether", host: "careers.tether.io" })).toBe(
      "https://careers.tether.io/api/offers/",
    );
  });
});

describe("location handling", () => {
  it("translates the country CODE into the shared Europe filter's vocabulary", () => {
    // The tenant renders `country` in its own career-site language; the ISO code
    // does not. This Berlin seat really is filed as "Allemagne" by its French tenant.
    const berlin = offerById(MATERA_PM);
    expect([berlin.country, berlin.country_code]).toEqual(["Allemagne", "DE"]);
    expect(pickLocation(berlin)).toBe("Berlin, Germany");
    expect(formatPlace("Amsterdam", "NL", "Nederland")).toBe("Amsterdam, Netherlands");
  });

  it("passes an unmapped country through untouched (it falls out of the filter, not silently rewritten)", () => {
    expect(formatPlace("Cairo", "EG", "Egypt")).toBe("Cairo, Egypt");
  });

  it("has no place at all when the offer names neither city nor country", () => {
    expect(formatPlace("", "", "")).toBeNull();
    expect(pickLocation({})).toBeNull();
  });

  it("never reads the localized top-level `location` string", () => {
    // "Werken op afstand" is the Dutch remote placeholder — a real Amsterdam seat.
    const droppie = offerById(DROPPIE_BD);
    expect(droppie.location).toBe("Werken op afstand");
    expect(pickLocation(droppie)).toBe("Amsterdam, Netherlands");
  });

  it("prefers the first European office on a multi-office posting", () => {
    // Top-level city is Abu Dhabi; the 9-office list holds Warsaw, London, Dublin…
    const wallets = offerById(TETHER_WALLETS);
    expect(wallets.city).toBe("Abu Dhabi");
    expect(pickLocation(wallets)).toBe("Warsaw, Poland"); // leading space in " Warsaw" trimmed
  });

  it("falls back to the first candidate when no office is European", () => {
    expect(pickLocation(offerById(TETHER_CAIRO))).toBe("Cairo, Egypt");
  });
});

describe("normalizeRecruiteeOffer", () => {
  const row = normalizeRecruiteeOffer(offerById(SEQURA_PM), "seQura");

  it("maps the offer onto the shared jobs row shape", () => {
    expect(row.company).toBe("seQura");
    expect(row.title).toBe("Senior Product Manager");
    expect(row.url).toBe("https://sequra.recruitee.com/o/senior-product-manager");
    expect(row.location).toBe("Barcelona, Spain");
    expect(row.remote).toBe(false);
    expect(row.source).toBe("recruitee");
    expect(row.seniority).toBe("senior");
    expect(row.role_family).toBe("product"); // #34 contract: every row carries one
  });

  it("prefers the board's display name over the legal entity in `company_name`", () => {
    const wallets = offerById(TETHER_WALLETS);
    expect(wallets.company_name).toBe("Tether Operations Limited");
    expect(normalizeRecruiteeOffer(wallets, "Tether").company).toBe("Tether");
    expect(normalizeRecruiteeOffer(wallets, null).company).toBe("Tether Operations Limited");
  });

  it("uses careers_url as-is so a custom career domain survives", () => {
    expect(normalizeRecruiteeOffer(offerById(TETHER_WALLETS), "Tether").url).toBe(
      "https://careers.tether.io/o/backend-engineer-wallets-100-remote-worldwide",
    );
  });

  it("normalizes the published_at stamp to an ISO instant", () => {
    expect(row.posted_at).toBe(new Date("2026-03-13 10:19:09 UTC").toISOString());
    expect(row.posted_at).toBe("2026-03-13T10:19:09.000Z");
  });

  it("falls back to created_at when the offer was never published", () => {
    const unpublished = { ...offerById(SEQURA_PM), published_at: null };
    expect(normalizeRecruiteeOffer(unpublished, "seQura").posted_at).toBe(
      new Date("2026-03-13 09:43:43 UTC").toISOString(),
    );
  });

  it("reads only the `remote` boolean, not the unreliable hybrid/on_site siblings", () => {
    const wallets = normalizeRecruiteeOffer(offerById(TETHER_WALLETS), "Tether");
    expect(wallets.remote).toBe(true);
    // A hybrid Barcelona seat: hybrid=true, remote=false -> not a remote row.
    expect(offerById(SEQURA_PM).hybrid).toBe(true);
    expect(row.remote).toBe(false);
  });

  it("carries description AND requirements inline, stripped of markup", () => {
    // requirements is frequently the LONGER half (the must-haves a JD-vs-CV
    // rubric scores against), so description alone would throw away the answer.
    expect(row.jd_text).toContain("seQura provides innovative");
    expect(row.jd_text).toContain("What we are looking for");
    expect(row.jd_text!).not.toMatch(/</);
    expect(row.jd_text!.length).toBeLessThanOrEqual(8000);
  });

  it("keeps the description when an offer carries no requirements block", () => {
    const open = normalizeRecruiteeOffer(offerById(DROPPIE_OPEN), "Droppie");
    expect(offerById(DROPPIE_OPEN).requirements).toBeNull();
    expect(open.jd_text).toBeTruthy();
    expect(open.jd_text).not.toMatch(/null|undefined/);
  });

  it("yields null jd_text when the offer has no body at all", () => {
    const bare = { ...offerById(SEQURA_PM), description: null, requirements: null };
    expect(normalizeRecruiteeOffer(bare, "seQura").jd_text).toBeNull();
  });
});

describe("parseRecruiteeOffers", () => {
  const rows = parseRecruiteeOffers(doc, "seQura");

  it("keeps only European in-scope roles (#34 all-vertical: engineering and sales included)", () => {
    expect(rows.map((r: { title: string }) => r.title)).toEqual([
      "Senior Product Manager", // Barcelona
      "Product Manager (m/w/d)", // Berlin, rescued from the French "Allemagne"
      "Business Development Stagiair", // Amsterdam, behind a remote placeholder
      "Backend Engineer - Wallets (100% remote Worldwide)", // Warsaw, from the office list
    ]);
  });

  it("drops the out-of-scope seats: a design role and an open application", () => {
    const titles = rows.map((r: { title: string }) => r.title);
    expect(doc.offers).toHaveLength(7);
    expect(offerById(SEQURA_DESIGN).title).toBe("Senior Motion & Graphic Designer"); // design deferred
    expect(titles).not.toContain("Senior Motion & Graphic Designer");
    expect(titles).not.toContain("Open Sollicitatie");
  });

  it("keeps a non-European posting out of the pool", () => {
    expect(rows.some((r: { url: string }) => r.url === offerById(TETHER_CAIRO).careers_url)).toBe(
      false,
    );
  });

  it("stamps role_family on every surviving row", () => {
    expect(rows.map((r: { role_family: string }) => r.role_family)).toEqual([
      "product",
      "product",
      "sales",
      "engineering",
    ]);
  });

  it("ignores an offer the tenant has not published", () => {
    const closed = { offers: [{ ...offerById(SEQURA_PM), status: "closed" }] };
    expect(parseRecruiteeOffers(closed, "seQura")).toEqual([]);
  });

  it("drops an offer with no careers_url — the row would have no apply link", () => {
    const noUrl = { offers: [{ ...offerById(SEQURA_PM), careers_url: null }] };
    expect(parseRecruiteeOffers(noUrl, "seQura")).toEqual([]);
  });

  it("survives an empty or malformed document instead of throwing", () => {
    expect(parseRecruiteeOffers({ offers: [] }, "X")).toEqual([]);
    expect(parseRecruiteeOffers(null, "X")).toEqual([]);
    expect(parseRecruiteeOffers({}, "X")).toEqual([]);
    expect(parseRecruiteeOffers({ offers: [null] }, "X")).toEqual([]);
  });
});

describe("isRecruiteeFeed", () => {
  it("accepts the real document and a live-but-empty board", () => {
    expect(isRecruiteeFeed(doc)).toBe(true);
    // bizzy/tiboenergy/chapter answer 200 with exactly this body — a real board
    // with nothing open, which an items-must-be-non-empty check would reject.
    expect(isRecruiteeFeed({ offers: [] })).toBe(true);
  });

  it("rejects anything that is not a Recruitee offers document", () => {
    expect(isRecruiteeFeed(null)).toBe(false);
    expect(isRecruiteeFeed("{}")).toBe(false);
    expect(isRecruiteeFeed({ error: "Not Found" })).toBe(false); // the 404 body
    expect(isRecruiteeFeed([])).toBe(false);
    expect(isRecruiteeFeed({ items: [] })).toBe(false); // a Teamtailor feed
  });
});

describe("aggregator boards (the Getro mis-attribution class)", () => {
  // jobsatlanticvc.recruitee.com is a VC talent board: 13 of its 14 offers sit in
  // department "Portfolio Company" and advertise OTHER companies' roles. Its
  // `company_name` is "atlantic.vc" on every single offer, so the real employer
  // exists nowhere in the payload — it appears only inside the title, as
  // "... @ DeepTech Scale-Up". There is nothing to re-attribute to, and shipping
  // them under the board owner is exactly the bug #102 fixed for Getro (Beekeeper
  // rows carrying LumApps postings). A missing row beats a wrong employer.
  const portfolio = {
    // A title that genuinely survives the scope filters, so this test fails for
    // the reason it names. The board's own engineering titles get dropped a step
    // earlier, which made an Engineer fixture pass green while the bug was live.
    title: "Product Manager @ Space Defence Venture",
    department: "Portfolio Company",
    company_name: "atlantic.vc",
    status: "published",
    careers_url: "https://jobsatlanticvc.recruitee.com/o/robotics-engineer",
    location: "Berlin",
    country_code: "DE",
    description: "<p>Join our portfolio company.</p>",
  };
  const ownRole = {
    title: "Product Manager",
    department: "Core Team",
    company_name: "atlantic.vc",
    status: "published",
    careers_url: "https://jobsatlanticvc.recruitee.com/o/product-manager",
    location: "Berlin",
    country_code: "DE",
    description: "<p>Join us.</p>",
  };

  it("drops offers a board is hosting on another company's behalf", () => {
    const rows = parseRecruiteeOffers({ offers: [portfolio] }, "Atlantic Labs");
    expect(rows).toEqual([]);
  });

  it("keeps the board owner's own roles", () => {
    const rows = parseRecruiteeOffers({ offers: [ownRole] }, "Atlantic Labs");
    expect(rows).toHaveLength(1);
    expect(rows[0].company).toBe("Atlantic Labs");
  });
});

describe("board list excludes known aggregators", () => {
  // A board can only be judged by looking at it, so the verdict is recorded once
  // and pinned here. Re-adding either token silently reintroduces rows filed
  // under the wrong employer, and the department guard above catches only one of
  // the two shapes: Wisemen files client roles under an ordinary "Sales"
  // department, so nothing in the payload marks them.
  it("does not seed venture or agency boards that host other companies' roles", () => {
    const boards = JSON.parse(
      readFileSync(join(process.cwd(), "scripts/boards.json"), "utf8"),
    ) as { recruitee: { token?: string }[]; _excluded_boards: { recruitee: { token: string }[] } };
    const seeded = new Set(boards.recruitee.map((b) => b.token));
    for (const { token } of boards._excluded_boards.recruitee) {
      expect(seeded.has(token), `${token} is a documented aggregator, keep it out of the board list`).toBe(false);
    }
  });
});
