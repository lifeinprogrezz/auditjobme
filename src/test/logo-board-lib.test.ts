// Pins reading the company website an ATS board PUBLISHES (scripts/logo-board-lib.mjs),
// issue #153 round 5.
//
// Contract: what the board published beats what a handle can be made to spell.
// The handle route is wrong about 1 time in 10 and cannot be validated straight,
// because a parked domain built from the handle carries the company name by
// construction. Every fixture below is a real response captured live on
// 2026-08-27 from the board named in its comment — no invented field names, and
// nothing here touches the network.
import { describe, expect, it } from "vitest";
import {
  LOGO_SOURCE_BOARD,
  LOGO_SOURCE_GUESS,
  LOGO_SOURCE_MANUAL,
  LOGO_SOURCE_COMPANY_URL,
  boardWebsiteRequest,
  boardPublishesWebsite,
  boardCompanyFromResponse,
  boardOwnershipOk,
  logoDomainFromWebsite,
  preferLogoDomain,
  isRevisitableSource,
  isMissingLogoSourceColumnError,
  isWritableWithoutProvenance,
  newBoardTally,
  boardSummaryLine,
} from "../../scripts/logo-board-lib.mjs";
import { candidateDomains } from "../../scripts/logo-handle-lib.mjs";

/** The Ashby board shell, with the real organization block of that tenant.
 *  window.__appData is one long line holding several thousand keys and deep
 *  nesting, so the surrounding noise is kept: a non-greedy regex stops at the
 *  first inner "}" and reads nothing, which is how Granola was missed. */
const ashbyPage = (organization: unknown) =>
  `<!doctype html><html><head><title>Current Openings</title></head><body>` +
  `<script>window.__appData = {"ddRumApplicationId":"80e0bf43","environment":"production",` +
  `"maintenanceMode":false,"organization":${JSON.stringify(organization)},` +
  `"theme":{"jobBoardTopDescriptionHtml":null,"applicationConfirmation":"Thanks {name}, we'll be in touch."},` +
  `"posting":null,"customDomainData":null};</script></body></html>`;

// jobs.ashbyhq.com/{handle} — organization.{name,publicWebsite,customJobsPageUrl}
const ASHBY = {
  finto: { name: "Finto", publicWebsite: "https://www.gofinto.com/", customJobsPageUrl: null },
  nevis: { name: "Nevis Wealth", publicWebsite: "https://www.neviswealth.com/", customJobsPageUrl: null },
  neuralconcept: { name: "Neural Concept", publicWebsite: "https://www.neuralconcept.com", customJobsPageUrl: null },
  lime: { name: "Lime", publicWebsite: "https://www.li.me/", customJobsPageUrl: "https://www.li.me/about/careers" },
  granola: { name: "Granola", publicWebsite: null, customJobsPageUrl: "https://www.granola.ai/jobs" },
  adaptyv: { name: "Adaptyv", publicWebsite: "https://adaptyvbio.com", customJobsPageUrl: "https://adaptyvbio.com/careers" },
  checkly: { name: "Checkly", publicWebsite: "https://checklyhq.com", customJobsPageUrl: null },
  carwow: { name: "Carwow", publicWebsite: "https://www.carwow.co.uk", customJobsPageUrl: null },
};

// GET apply.workable.com/api/v1/accounts/annamoney
const WORKABLE_ANNA = {
  id: 665349,
  subdomain: "annamoney",
  name: "ANNA Money",
  url: "https://anna.money/",
  logo: "https://workablehr.s3.amazonaws.com/uploads/account/logo/665349/logo",
};

// jobs.lever.co/intropic — the WHOLE shape, not just the footer. Lever inlines
// its stylesheet into every board, and that stylesheet names `.main-footer-text`
// about 400 KB BEFORE the footer element does (at byte 294,779 of the live page
// on 2026-08-27; the footer is at 718,246). A reader scoped to the bare string
// therefore reads CSS, finds no anchor and returns null on every real Lever
// board — which is what it did until this fixture carried the preamble. Both
// halves below are verbatim substrings of the live response.
const LEVER_CSS_PREAMBLE =
  "<style>.main-footer-text {background: #edeef1;text-align: center;padding: 40px 30px;}" +
  ".main-footer-text p {display: block;max-width: 500px;margin: 0px auto;}" +
  ".posting-header h2 {margin-top: 0px;}</style>";
const LEVER_FOOTER =
  '<div class="main-footer page-full-width"><div class="main-footer-text"><p>' +
  '<a href="http://intropic.io">Intropic Home Page</a></p>' +
  '<a href="https://www.lever.co/job-seeker-support/" class="image-link"><span>Jobs powered by </span>' +
  '<img alt="Lever logo" src="/img/lever-logo-refresh.svg" class="footer-logo"></a></div></div>';
const LEVER_INTROPIC = `<!doctype html><html><head>${LEVER_CSS_PREAMBLE}</head><body>` +
  `<div class="postings-wrapper">${"x".repeat(400)}</div>${LEVER_FOOTER}</body></html>`;

// job-boards.greenhouse.io/cabify — the board logo links the company's own site
const GREENHOUSE_CABIFY =
  "<title>Jobs at Cabify</title><main><div class=\"image-container\">" +
  '<a href="https://cabify.careers/" target="_blank" rel="noreferrer" class="logo">' +
  '<img src="https://s2-recruiting.cdn.greenhouse.io/external_greenhouse_job_boards/logos/400/121/700/original/logo.png"></a></div></main>';

// join.com/companies/senvo — schema.org Organization; `url` is the join.com page,
// `sameAs` is the company's site.
const JOIN_SENVO =
  '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization",' +
  '"name":"senvo GmbH","url":"https://join.com/companies/senvo",' +
  '"logo":"https://cdn.join.com/6a58ce927abeb100089846d6/senvo-gmb-h-logo-m.png",' +
  '"description":"Senvo is an AI-native logistics infrastructure company.","sameAs":"https://senvo.ai"}</script>';

describe("boardWebsiteRequest", () => {
  it("asks each board at the endpoint that carries its published website", () => {
    expect(boardWebsiteRequest("ashby", "granola")).toMatchObject({
      url: "https://jobs.ashbyhq.com/granola",
      kind: "html",
    });
    expect(boardWebsiteRequest("workable", "annamoney")).toMatchObject({
      url: "https://apply.workable.com/api/v1/accounts/annamoney",
      kind: "json",
    });
    expect(boardWebsiteRequest("lever", "intropic")).toMatchObject({ url: "https://jobs.lever.co/intropic" });
    expect(boardWebsiteRequest("greenhouse", "cabify")).toMatchObject({
      url: "https://job-boards.greenhouse.io/cabify",
    });
    expect(boardWebsiteRequest("join", "senvo")).toMatchObject({ url: "https://join.com/companies/senvo" });
  });

  it("publishes nothing for an ATS with no website field, and never builds a request without a handle", () => {
    expect(boardPublishesWebsite("smartrecruiters")).toBe(false);
    expect(boardPublishesWebsite("personio")).toBe(false);
    expect(boardWebsiteRequest("smartrecruiters", "omio")).toBeNull();
    expect(boardWebsiteRequest("ashby", "")).toBeNull();
  });
});

describe("boardCompanyFromResponse", () => {
  it("reads Ashby's organization block out of the full page", () => {
    expect(boardCompanyFromResponse("ashby", ashbyPage(ASHBY.carwow))).toEqual({
      name: "Carwow",
      website: "https://www.carwow.co.uk",
    });
  });

  it("falls back to Ashby's own careers-page URL when publicWebsite is empty (Granola)", () => {
    expect(boardCompanyFromResponse("ashby", ashbyPage(ASHBY.granola))).toEqual({
      name: "Granola",
      website: "https://www.granola.ai/jobs",
    });
  });

  it("returns null when the board answered but published no website", () => {
    expect(boardCompanyFromResponse("ashby", ashbyPage(null))).toBeNull();
    expect(
      boardCompanyFromResponse("ashby", ashbyPage({ name: "Adaptyv", publicWebsite: null, customJobsPageUrl: null })),
    ).toBeNull();
    expect(boardCompanyFromResponse("workable", { name: "Somebody", url: null })).toBeNull();
    expect(boardCompanyFromResponse("lever", "<div>no footer here</div>")).toBeNull();
    expect(boardCompanyFromResponse("greenhouse", "<title>Jobs at X</title><main></main>")).toBeNull();
    expect(boardCompanyFromResponse("join", "<script>not ld json</script>")).toBeNull();
  });

  it("reads Workable's account url", () => {
    expect(boardCompanyFromResponse("workable", WORKABLE_ANNA)).toEqual({
      name: "ANNA Money",
      website: "https://anna.money/",
    });
  });

  it("reads Lever's footer home-page link and skips Lever's own links", () => {
    expect(boardCompanyFromResponse("lever", LEVER_INTROPIC)).toEqual({
      name: "Intropic",
      website: "http://intropic.io",
    });
  });

  it("reads past Lever's inlined stylesheet, which names main-footer-text first", () => {
    // The guard for the defect above: the page must still resolve when the
    // string appears in CSS before it appears as an element. Drop the
    // preamble and the assertion still passes, so it is the preamble that
    // carries the test — keep it.
    expect(LEVER_INTROPIC.indexOf("main-footer-text")).toBeLessThan(LEVER_INTROPIC.indexOf("<div class=\"main-footer"));
    expect(boardCompanyFromResponse("lever", LEVER_INTROPIC)?.website).toBe("http://intropic.io");
    // A stylesheet on its own publishes nothing.
    expect(boardCompanyFromResponse("lever", LEVER_CSS_PREAMBLE)).toBeNull();
  });

  it("reads Greenhouse's board logo link and Workable-style board title", () => {
    expect(boardCompanyFromResponse("greenhouse", GREENHOUSE_CABIFY)).toEqual({
      name: "Cabify",
      website: "https://cabify.careers/",
    });
  });

  it("reads join.com's Organization sameAs, never its join.com url", () => {
    expect(boardCompanyFromResponse("join", JOIN_SENVO)).toEqual({ name: "senvo GmbH", website: "https://senvo.ai" });
  });

  it("knows nothing about an ATS it has no reader for", () => {
    expect(boardCompanyFromResponse("teamtailor", "<html></html>")).toBeNull();
  });
});

describe("boardOwnershipOk", () => {
  it("accepts a board name that extends the company name", () => {
    // The truth a handle can never reach: the tenant is "nevis", the company is
    // "Nevis", and the board calls it "Nevis Wealth" at neviswealth.com.
    expect(boardOwnershipOk({ boardName: "Nevis Wealth", handle: "nevis", companyName: "Nevis" })).toBe(true);
    expect(boardOwnershipOk({ boardName: "Neural Concept", handle: "neuralconcept", companyName: "Neuralconcept" })).toBe(true);
    expect(boardOwnershipOk({ boardName: "senvo GmbH", handle: "senvo", companyName: "senvo" })).toBe(true);
  });

  it("accepts a board that publishes no name at all when the handle names the company", () => {
    expect(boardOwnershipOk({ boardName: null, handle: "intropic", companyName: "Intropic" })).toBe(true);
  });

  it("refuses a tenant that belongs to a different company", () => {
    // Both live rows today: the apply URL points at somebody else's board.
    expect(boardOwnershipOk({ boardName: "deskbird", handle: "deskbird", companyName: "Semana" })).toBe(false);
    expect(boardOwnershipOk({ boardName: "Novata", handle: "novata", companyName: "Atlas Metrics" })).toBe(false);
    expect(boardOwnershipOk({ boardName: "Finto", handle: "finto", companyName: "" })).toBe(false);
    // A prefix shorter than four characters is not a name match, the same floor
    // handleMatchesName uses: "Ito" must not own Itonics' board.
    expect(boardOwnershipOk({ boardName: "Ito", handle: "ito", companyName: "Itonics" })).toBe(false);
  });
});

describe("logoDomainFromWebsite", () => {
  it("keeps the registrable domain and drops a careers label", () => {
    expect(logoDomainFromWebsite("https://www.li.me/about/careers")).toBe("li.me");
    expect(logoDomainFromWebsite("https://anna.money/")).toBe("anna.money");
    expect(logoDomainFromWebsite("https://www.carwow.co.uk")).toBe("carwow.co.uk");
    expect(logoDomainFromWebsite("https://careers.macadam.app")).toBe("macadam.app");
  });

  it("refuses a board that links back at itself or at a platform", () => {
    expect(logoDomainFromWebsite("https://jobs.ashbyhq.com/granola")).toBeNull();
    expect(logoDomainFromWebsite("https://www.linkedin.com/company/x")).toBeNull();
    expect(logoDomainFromWebsite("https://www.welcometothejungle.com/companies/x")).toBeNull();
    expect(logoDomainFromWebsite(null)).toBeNull();
  });
});

describe("preferLogoDomain", () => {
  it("takes the board's website over the handle guess", () => {
    expect(preferLogoDomain({ boardDomain: "gofinto.com", guessDomain: "finto.com" })).toEqual({
      domain: "gofinto.com",
      source: LOGO_SOURCE_BOARD,
    });
  });

  it("falls back to the guess only when no board published one", () => {
    expect(preferLogoDomain({ boardDomain: null, guessDomain: "finto.com" })).toEqual({
      domain: "finto.com",
      source: LOGO_SOURCE_GUESS,
    });
    expect(preferLogoDomain({})).toBeNull();
  });
});

// The four writes an adversarial replay of 60 live companies caught on
// 2026-08-27: each one is another company's mark, each one passed every gate the
// guess route has, and each one is answered by the board. This is the test the
// change exists for -- break boardCompanyFromResponse and all four go red,
// because preferLogoDomain then falls through to the guess.
describe("the four known-wrong writes", () => {
  const WRONG = [
    { slug: "finto", name: "Finto", handle: "finto", org: ASHBY.finto, wrong: "finto.com", right: "gofinto.com" },
    { slug: "nevis", name: "Nevis", handle: "nevis", org: ASHBY.nevis, wrong: "nevis.com", right: "neviswealth.com" },
    {
      slug: "neuralconcept",
      name: "Neuralconcept",
      handle: "neuralconcept",
      org: ASHBY.neuralconcept,
      wrong: "neuralconcept.ai",
      right: "neuralconcept.com",
    },
    { slug: "lime", name: "Lime", handle: "lime", org: ASHBY.lime, wrong: "lime.ai", right: "li.me" },
  ];

  for (const c of WRONG) {
    it(`${c.name}: the board says ${c.right}, the handle can only spell ${c.wrong}`, () => {
      // 1. the wrong domain really is one the handle route would produce.
      expect(candidateDomains(c.handle, "ashby")).toContain(c.wrong);
      // 2. the board publishes the right one, and it survives every gate.
      const published = boardCompanyFromResponse("ashby", ashbyPage(c.org));
      expect(published).not.toBeNull();
      expect(boardOwnershipOk({ boardName: published!.name, handle: c.handle, companyName: c.name })).toBe(true);
      const boardDomain = logoDomainFromWebsite(published!.website);
      expect(boardDomain).toBe(c.right);
      // 3. and it is what actually gets written.
      expect(preferLogoDomain({ boardDomain, guessDomain: c.wrong })).toEqual({
        domain: c.right,
        source: LOGO_SOURCE_BOARD,
      });
    });
  }

  it("reaches domains no handle could ever generate", () => {
    for (const [handle, org, right] of [
      ["adaptyv", ASHBY.adaptyv, "adaptyvbio.com"],
      ["checkly", ASHBY.checkly, "checklyhq.com"],
      ["carwow", ASHBY.carwow, "carwow.co.uk"],
    ] as const) {
      const published = boardCompanyFromResponse("ashby", ashbyPage(org));
      expect(logoDomainFromWebsite(published!.website)).toBe(right);
      expect(candidateDomains(handle, "ashby")).not.toContain(right);
    }
    const anna = boardCompanyFromResponse("workable", WORKABLE_ANNA);
    expect(logoDomainFromWebsite(anna!.website)).toBe("anna.money");
    expect(candidateDomains("annamoney", "workable")).not.toContain("anna.money");
  });
});

describe("provenance", () => {
  it("refuses to write a guess into a database with no provenance column", () => {
    // The nightly workflows run this script with --apply. Merging before
    // migration 20260827190000 is applied would write a fresh batch of guesses
    // that no later run could ever tell from a good value and replace —
    // exactly the permanence this change exists to end. Facts still go in.
    expect(isWritableWithoutProvenance(LOGO_SOURCE_GUESS)).toBe(false);
    expect(isWritableWithoutProvenance(LOGO_SOURCE_BOARD)).toBe(true);
    expect(isWritableWithoutProvenance(LOGO_SOURCE_COMPANY_URL)).toBe(true);
    expect(isWritableWithoutProvenance(LOGO_SOURCE_MANUAL)).toBe(true);
  });

  it("lets the backfill replace only a guess", () => {
    expect(isRevisitableSource(LOGO_SOURCE_GUESS)).toBe(true);
    expect(isRevisitableSource(LOGO_SOURCE_BOARD)).toBe(false);
    expect(isRevisitableSource(LOGO_SOURCE_COMPANY_URL)).toBe(false);
    expect(isRevisitableSource(LOGO_SOURCE_MANUAL)).toBe(false);
    expect(isRevisitableSource(null)).toBe(false); // predates the column: unknown, do not touch
  });

  it("recognises a database that has no logo_domain_source column yet", () => {
    expect(isMissingLogoSourceColumnError({ code: "PGRST204" })).toBe(true);
    expect(isMissingLogoSourceColumnError({ code: "42703" })).toBe(true);
    expect(
      isMissingLogoSourceColumnError({
        message: "Could not find the 'logo_domain_source' column of 'companies' in the schema cache",
      }),
    ).toBe(true);
    expect(isMissingLogoSourceColumnError({ code: "23514", message: "violates check constraint" })).toBe(false);
    expect(isMissingLogoSourceColumnError(null)).toBe(false);
  });
});

describe("boardSummaryLine", () => {
  it("reports the run either way", () => {
    const t = newBoardTally();
    t.asked = 3;
    t.published = 2;
    t.resolved = 2;
    expect(boardSummaryLine(t, { apply: false })).toContain("[dry run] no writes");
    t.written = 2;
    expect(boardSummaryLine(t, { apply: true })).toContain("wrote 2");
  });
});
