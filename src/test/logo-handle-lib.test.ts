// Pins the ATS-handle logo derivation (scripts/logo-handle-lib.mjs), issue #153.
// Contract: a handle is a GUESS, so it only becomes a logo domain after a name
// gate, a hosted-ATS gate, a network probe, a check that the page which answers
// names the company, and a tie-break for when two do. Everything here is
// offline: the probe helpers are fed response shapes, never a real request.
//
// Every URL below is a real shape from the live pool (2026-08-26 dataplane
// artifact), not an invented one.
import { describe, expect, it } from "vitest";
import {
  atsHandleFromUrl,
  handleFromApplyUrls,
  normalizeHandle,
  normalizeName,
  handleMatchesName,
  candidateDomains,
  siteProbeVerdict,
  iconProbeVerdict,
  isParkingBody,
  pageNamesCompany,
  bodyLinksAtsTenant,
  atsTenantMarkers,
  classifyFetchError,
  isProbeCacheFresh,
  isMissingProbeTableError,
  newHandleTally,
  handleSummaryLine,
} from "../../scripts/logo-handle-lib.mjs";

describe("atsHandleFromUrl", () => {
  it("reads the tenant out of a path-shaped ATS URL", () => {
    expect(atsHandleFromUrl("https://jobs.ashbyhq.com/1password/b7fb4d5d-9053-4e70-b17a-8d401fd5b86b")).toEqual({
      ats: "ashby",
      handle: "1password",
    });
    expect(atsHandleFromUrl("https://boards.greenhouse.io/aiven36/jobs/4912951101")).toEqual({
      ats: "greenhouse",
      handle: "aiven36",
    });
    expect(atsHandleFromUrl("https://jobs.lever.co/alice-bob/07d3e615")).toEqual({ ats: "lever", handle: "alice-bob" });
    expect(atsHandleFromUrl("https://apply.workable.com/aidoptation/j/514df21ed3/")).toEqual({
      ats: "workable",
      handle: "aidoptation",
    });
    expect(atsHandleFromUrl("https://jobs.smartrecruiters.com/boschgroup/744000141666442")).toEqual({
      ats: "smartrecruiters",
      handle: "boschgroup",
    });
  });

  it("reads the tenant out of a subdomain-shaped ATS URL", () => {
    expect(atsHandleFromUrl("https://aikidosecurity.recruitee.com/o/account-executive-5")).toEqual({
      ats: "recruitee",
      handle: "aikidosecurity",
    });
    expect(atsHandleFromUrl("https://anybill.jobs.personio.de/job/2626867")).toEqual({
      ats: "personio",
      handle: "anybill",
    });
    expect(atsHandleFromUrl("https://ariadne.jobs.personio.com/job/1945636")).toEqual({
      ats: "personio",
      handle: "ariadne",
    });
    expect(atsHandleFromUrl("https://agiledayoy.teamtailor.com/jobs/7981196-senior-account-executive")).toEqual({
      ats: "teamtailor",
      handle: "agiledayoy",
    });
  });

  it("reads Workday's tenant from in front of the data-center label (this is how Adobe resolves)", () => {
    expect(atsHandleFromUrl("https://adobe.wd5.myworkdayjobs.com/external_experienced/job/London/Sales")).toEqual({
      ats: "workday",
      handle: "adobe",
    });
    expect(atsHandleFromUrl("https://acme.myworkdaysite.com/en-US/careers/job/1")).toEqual({
      ats: "workday",
      handle: "acme",
    });
  });

  it("reads join.com and dover, whose tenant sits behind a fixed first segment", () => {
    expect(atsHandleFromUrl("https://join.com/companies/ai-coustics/16610237-head-of-marketing")).toEqual({
      ats: "join",
      handle: "ai-coustics",
    });
    // dover puts the company NAME there, percent-encoded (this is how 5U AI resolves).
    expect(atsHandleFromUrl("https://app.dover.com/apply/5U%20AI/d1ee82fa-29cc-4703-a4a0-54c69d63153d/")).toEqual({
      ats: "dover",
      handle: "5U AI",
    });
  });

  it("reads greenhouse's embedded form, where the tenant is in the query", () => {
    expect(atsHandleFromUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=123")).toEqual({
      ats: "greenhouse",
      handle: "acme",
    });
    expect(atsHandleFromUrl("https://boards.greenhouse.io/?for=acme&token=123")).toEqual({
      ats: "greenhouse",
      handle: "acme",
    });
  });

  it("returns null for a host with no ATS tenant to read, and for garbage", () => {
    expect(atsHandleFromUrl("https://www.linkedin.com/jobs/view/123")).toBeNull();
    expect(atsHandleFromUrl("https://www.ycombinator.com/jobs/role/product-manager")).toBeNull();
    expect(atsHandleFromUrl("https://acme.com/careers/pm")).toBeNull();
    expect(atsHandleFromUrl("not a url")).toBeNull();
    expect(atsHandleFromUrl(null)).toBeNull();
  });

  it("handleFromApplyUrls takes the first URL that yields a handle", () => {
    expect(
      handleFromApplyUrls([
        "https://www.linkedin.com/jobs/view/1",
        "https://jobs.ashbyhq.com/adaptyv/abc",
        "https://jobs.lever.co/other/1",
      ]),
    ).toEqual({ ats: "ashby", handle: "adaptyv" });
    expect(handleFromApplyUrls([])).toBeNull();
    expect(handleFromApplyUrls(undefined)).toBeNull();
  });
});

describe("normalizeHandle", () => {
  it("folds a handle into something that can sit in a hostname", () => {
    expect(normalizeHandle("5U AI")).toBe("5u-ai");
    expect(normalizeHandle("Tools for Humanity")).toBe("tools-for-humanity");
    expect(normalizeHandle("hellgruen_energie")).toBe("hellgruen-energie");
    expect(normalizeHandle("1Password")).toBe("1password");
  });

  it("refuses a handle that names the board instead of a company", () => {
    // Real rows today: SeedLegals' workable URL says "jobs", Quivo's join URL says "join".
    expect(normalizeHandle("jobs")).toBeNull();
    expect(normalizeHandle("join")).toBeNull();
    expect(normalizeHandle("careers")).toBeNull();
    expect(normalizeHandle("embed")).toBeNull();
  });

  it("refuses a handle too short or with no letters", () => {
    expect(normalizeHandle("ab")).toBeNull();
    expect(normalizeHandle("12345")).toBeNull();
    expect(normalizeHandle("")).toBeNull();
    expect(normalizeHandle(null)).toBeNull();
  });
});

describe("normalizeName", () => {
  it("folds accents, drops punctuation and a trailing legal suffix", () => {
    expect(normalizeName("EINHUNDERT Energy GmbH")).toBe("einhundertenergy");
    expect(normalizeName("hellgrün")).toBe("hellgrun");
    expect(normalizeName("Nodes & Links")).toBe("nodeslinks");
  });

  it("decodes a name that reached the pool still percent-encoded", () => {
    expect(normalizeName("Protex%20AI")).toBe("protexai");
    expect(normalizeName("Tools%20for%20Humanity")).toBe("toolsforhumanity");
  });
});

describe("handleMatchesName — the gate that keeps another company's logo out", () => {
  it("accepts a handle that is the company's own name", () => {
    expect(handleMatchesName("1password", "1Password")).toBe(true);
    expect(handleMatchesName("adobe", "Adobe")).toBe(true);
    expect(handleMatchesName("adaptyv", "Adaptyv")).toBe(true);
    expect(handleMatchesName("5U AI", "5U AI")).toBe(true);
    expect(handleMatchesName("alice-bob", "Alice & Bob")).toBe(true);
  });

  it("accepts a longer handle that starts with the name, and the other way round", () => {
    expect(handleMatchesName("aikidosecurity", "Aikido")).toBe(true);
    expect(handleMatchesName("adaptyv", "Adaptyv Biosystems")).toBe(true);
  });

  it("rejects a handle pointing at a DIFFERENT company (both are live rows today)", () => {
    expect(handleMatchesName("deskbird", "Semana")).toBe(false);
    expect(handleMatchesName("novata", "Atlas Metrics")).toBe(false);
    expect(handleMatchesName("jobs", "SeedLegals")).toBe(false);
  });

  it("rejects a three-letter overlap, which is too little to be evidence", () => {
    expect(handleMatchesName("iqm", "IQM Quantum Computers")).toBe(false);
  });

  it("rejects empty input rather than matching everything", () => {
    expect(handleMatchesName("", "Acme")).toBe(false);
    expect(handleMatchesName("acme", "")).toBe(false);
  });
});

describe("candidateDomains", () => {
  it("puts the plain .com first and caps the list", () => {
    expect(candidateDomains("1password", "ashby")).toEqual(["1password.com", "1password.io", "1password.ai"]);
    expect(candidateDomains("alice-bob", "lever")).toEqual([
      "alice-bob.com",
      "alicebob.com",
      "alice-bob.io",
      "alice-bob.ai",
    ]);
    expect(candidateDomains("alice-bob", "lever", { max: 2 })).toEqual(["alice-bob.com", "alicebob.com"]);
  });

  it("tries the dot back when the handle's last word is a top-level domain (this is how 5U AI resolves)", () => {
    expect(candidateDomains("5U AI", "dover")).toEqual(["5u-ai.com", "5u.ai", "5uai.com", "5u-ai.io"]);
    // A last word that only looks like one stays a word.
    expect(candidateDomains("alice-bob", "lever")).not.toContain("alice.bob");
  });

  it("un-glues a join.com tenant, which is the company domain with the dots removed", () => {
    expect(candidateDomains("spotixxcom", "join")[0]).toBe("spotixx.com");
    // A dashed join tenant is a slug, not a glued domain: leave it alone.
    expect(candidateDomains("ai-coustics", "join")[0]).toBe("ai-coustics.com");
  });

  it("returns nothing for a handle that never should have been used", () => {
    expect(candidateDomains("jobs", "workable")).toEqual([]);
    expect(candidateDomains("", "ashby")).toEqual([]);
  });
});

describe("siteProbeVerdict", () => {
  it("accepts a candidate that answers on its own registrable domain", () => {
    expect(siteProbeVerdict({ status: 200, finalUrl: "https://1password.com/", candidate: "1password.com" })).toBe("ok");
    expect(siteProbeVerdict({ status: 200, finalUrl: "https://www.adobe.com/uk/", candidate: "adobe.com" })).toBe("ok");
  });

  it("rejects a redirect to another company or platform", () => {
    expect(siteProbeVerdict({ status: 200, finalUrl: "https://someoneelse.com/", candidate: "acme.com" })).toBe(
      "offsite",
    );
    expect(
      siteProbeVerdict({ status: 200, finalUrl: "https://www.linkedin.com/company/acme", candidate: "acme.com" }),
    ).toBe("offsite");
  });

  it("rejects a redirect to a domain-parking or for-sale host", () => {
    expect(siteProbeVerdict({ status: 200, finalUrl: "https://www.hugedomains.com/acme", candidate: "acme.com" })).toBe(
      "parked",
    );
    expect(siteProbeVerdict({ status: 200, finalUrl: "https://sedoparking.com/acme.com", candidate: "acme.com" })).toBe(
      "parked",
    );
  });

  it("calls a non-answer dead, including an unreadable final URL", () => {
    expect(siteProbeVerdict({ status: 404, finalUrl: "https://acme.com/", candidate: "acme.com" })).toBe("dead");
    expect(siteProbeVerdict({ status: 0, finalUrl: "", candidate: "acme.com" })).toBe("dead");
    expect(siteProbeVerdict({ status: 200, finalUrl: "", candidate: "acme.com" })).toBe("dead");
  });

  it("treats a second-level ccTLD as one domain, not a shared one", () => {
    expect(siteProbeVerdict({ status: 200, finalUrl: "https://www.acme.co.uk/", candidate: "acme.co.uk" })).toBe("ok");
    expect(siteProbeVerdict({ status: 200, finalUrl: "https://other.co.uk/", candidate: "acme.co.uk" })).toBe("offsite");
  });
});

describe("iconProbeVerdict", () => {
  it("accepts only a 200 carrying image bytes", () => {
    expect(iconProbeVerdict({ status: 200, contentType: "image/x-icon", contentLength: "1" })).toBe("ok");
    expect(iconProbeVerdict({ status: 200, contentType: "image/png; charset=binary", contentLength: null })).toBe("ok");
  });

  it("rejects a non-image answer, an empty body and any non-200", () => {
    expect(iconProbeVerdict({ status: 200, contentType: "text/html", contentLength: "512" })).toBe("reject");
    expect(iconProbeVerdict({ status: 200, contentType: "image/png", contentLength: "0" })).toBe("reject");
    expect(iconProbeVerdict({ status: 404, contentType: "image/png", contentLength: "10" })).toBe("reject");
    expect(iconProbeVerdict({ status: 200, contentType: null, contentLength: "10" })).toBe("reject");
  });
});

describe("isParkingBody", () => {
  it("spots a for-sale lander served on the candidate's own host", () => {
    expect(isParkingBody("<html><title>acme.com</title><h1>This domain is for sale</h1>")).toBe(true);
    expect(isParkingBody("<script src='https://parkingcrew.net/x.js'>")).toBe(true);
  });

  it("spots the wordless lander stub (annamoney.ai and ankar.com answered exactly this)", () => {
    expect(
      isParkingBody(
        '<!DOCTYPE html><html><head><script>window.onload=function(){window.location.href="/lander"}</script></head></html>',
      ),
    ).toBe(true);
  });

  it("leaves a real site alone", () => {
    expect(isParkingBody("<html><body>Password manager for teams</body></html>")).toBe(false);
    expect(isParkingBody("")).toBe(false);
    // A real single-page app shell also redirects, but it carries a page with it.
    expect(
      isParkingBody(
        `<html><head><title>Acme</title></head><body><div id="root"></div><script>if(!ok)location.href="/app"</script>${"x".repeat(500)}</body></html>`,
      ),
    ).toBe(false);
  });
});

describe("pageNamesCompany — the gate that catches a live site owned by someone else", () => {
  it("accepts a page that names the company, separators and all", () => {
    expect(pageNamesCompany("<title>1Password | Password manager</title>", "1Password")).toBe(true);
    expect(pageNamesCompany("<title>Airborne Counter-UAS Solutions | Alpine Eagle</title>", "Alpineeagle")).toBe(true);
    expect(pageNamesCompany('<meta property="og:site_name" content="Andercore">', "Andercore")).toBe(true);
    expect(pageNamesCompany('<meta name="application-name" content="Ai-Coustics">', "Ai Coustics")).toBe(true);
  });

  it("reads through HTML entities, which cost Alice & Bob its own domain", () => {
    expect(
      pageNamesCompany("<title> Building the First Universal Quantum Computer〡Alice &amp; Bob</title>", "Alice Bob"),
    ).toBe(true);
  });

  it("rejects a page whose brand is a different company", () => {
    expect(pageNamesCompany("<title>Acme Widgets, the best widgets</title>", "Northgoing")).toBe(false);
  });

  it("rejects a page that names itself nothing at all", () => {
    expect(pageNamesCompany("<html><body>hello</body></html>", "Acme")).toBe(false);
    expect(pageNamesCompany("", "Acme")).toBe(false);
  });
});

describe("bodyLinksAtsTenant — the tie-break when two live sites carry the name", () => {
  it("spots a link to the company's own board, per ATS shape", () => {
    // granola.ai/careers really does link this; granola.com (a food site) links nothing.
    expect(bodyLinksAtsTenant('<a href="https://jobs.ashbyhq.com/granola/5199bcf7">Apply</a>', "ashby", "granola")).toBe(
      true,
    );
    expect(bodyLinksAtsTenant('<a href="https://boards.greenhouse.io/acme/jobs/1">Jobs</a>', "greenhouse", "acme")).toBe(
      true,
    );
    expect(bodyLinksAtsTenant('<iframe src="https://acme.jobs.personio.de/">', "personio", "acme")).toBe(true);
    expect(bodyLinksAtsTenant('<a href="https://adobe.wd5.myworkdayjobs.com/x">Careers</a>', "workday", "adobe")).toBe(
      true,
    );
  });

  it("does not fire on the ATS alone, or on another tenant", () => {
    expect(bodyLinksAtsTenant('<a href="https://jobs.ashbyhq.com/someoneelse/1">', "ashby", "granola")).toBe(false);
    expect(bodyLinksAtsTenant("<p>we use Ashby</p>", "ashby", "granola")).toBe(false);
    expect(bodyLinksAtsTenant("", "ashby", "granola")).toBe(false);
  });

  it("names both the raw and the folded handle, so an encoded tenant still matches", () => {
    expect(atsTenantMarkers("dover", "5U AI")).toContain("dover.com/apply/5u ai");
    expect(atsTenantMarkers("dover", "5U AI")).toContain("dover.com/apply/5u-ai");
  });
});

describe("classifyFetchError", () => {
  it("calls only a name that does not resolve dead; everything else is unknown", () => {
    expect(classifyFetchError({ cause: { code: "ENOTFOUND" } })).toBe("dead");
    expect(classifyFetchError({ name: "TimeoutError" })).toBe("unreachable");
    expect(classifyFetchError({ cause: { code: "ECONNRESET" } })).toBe("unreachable");
    expect(classifyFetchError({ cause: { code: "CERT_HAS_EXPIRED" } })).toBe("unreachable");
    expect(classifyFetchError(undefined)).toBe("unreachable");
  });
});

describe("isMissingProbeTableError", () => {
  it("recognises both shapes, so the run degrades before the migration is applied", () => {
    expect(isMissingProbeTableError({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(
      isMissingProbeTableError({
        code: "PGRST205",
        message: "Could not find the table 'public.logo_probe_cache' in the schema cache",
      }),
    ).toBe(true);
  });

  it("leaves a real error alone, so it is reported rather than swallowed", () => {
    expect(isMissingProbeTableError({ code: "42501", message: "permission denied for table" })).toBe(false);
    expect(isMissingProbeTableError(null)).toBe(false);
  });
});

describe("isProbeCacheFresh", () => {
  const now = Date.parse("2026-08-27T12:00:00Z");

  it("keeps a success forever", () => {
    expect(isProbeCacheFresh({ ok: true, probed_at: "2020-01-01T00:00:00Z" }, now)).toBe(true);
  });

  it("keeps a failure for the negative window, then lets it be re-probed", () => {
    expect(isProbeCacheFresh({ ok: false, probed_at: "2026-08-20T00:00:00Z" }, now)).toBe(true);
    expect(isProbeCacheFresh({ ok: false, probed_at: "2026-06-01T00:00:00Z" }, now)).toBe(false);
  });

  it("treats a missing row or an unreadable date as not cached", () => {
    expect(isProbeCacheFresh(undefined, now)).toBe(false);
    expect(isProbeCacheFresh({ ok: false, probed_at: null }, now)).toBe(false);
  });
});

describe("handleSummaryLine", () => {
  it("names every counter, and says plainly when nothing was written", () => {
    const t = newHandleTally();
    t.companies = 3;
    t.candidatesTried = 5;
    t.validated = 2;
    t.rejected = 3;
    expect(handleSummaryLine(t, { apply: false })).toContain("[dry run] no writes");
    t.written = 2;
    expect(handleSummaryLine(t, { apply: true })).toContain("wrote 2");
  });
});
