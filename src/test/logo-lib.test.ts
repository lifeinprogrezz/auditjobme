// Pins logo-domain derivation (scripts/logo-lib.mjs), issue #68 item 4.
// Contract: derive ONLY from URLs the company owns (careers_url, then website);
// hosted-ATS/platform hosts yield null — a wrong domain renders a WRONG logo.
import { describe, expect, it } from "vitest";
import { deriveLogoDomain, domainFromUrl, resolveLogoDomain } from "../../scripts/logo-lib.mjs";

describe("domainFromUrl", () => {
  it("derives the Macadam class: careers.macadam.app -> macadam.app", () => {
    expect(domainFromUrl("https://careers.macadam.app")).toBe("macadam.app");
    expect(domainFromUrl("https://careers.macadam.app/jobs/pm")).toBe("macadam.app");
  });

  it("strips a single leading careers-ish label (www/jobs/apply)", () => {
    expect(domainFromUrl("https://www.acme.com/")).toBe("acme.com");
    expect(domainFromUrl("https://jobs.acme.co.uk/vacancies")).toBe("acme.co.uk");
    expect(domainFromUrl("https://apply.acme.io")).toBe("acme.io");
  });

  it("leaves a bare two-label domain alone", () => {
    expect(domainFromUrl("https://macadam.app")).toBe("macadam.app");
  });

  it("hosted-ATS / platform hosts are NEVER a company domain", () => {
    expect(domainFromUrl("https://macadam.teamtailor.com")).toBeNull();
    expect(domainFromUrl("https://boards.greenhouse.io/acme")).toBeNull();
    expect(domainFromUrl("https://jobs.lever.co/acme")).toBeNull();
    expect(domainFromUrl("https://jobs.ashbyhq.com/acme")).toBeNull();
    expect(domainFromUrl("https://apply.workable.com/acme")).toBeNull();
    expect(domainFromUrl("https://acme.jobs.personio.de")).toBeNull();
    expect(domainFromUrl("https://www.linkedin.com/company/acme")).toBeNull();
    expect(domainFromUrl("https://acme.notion.site/careers")).toBeNull();
  });

  it("tolerates scheme-less values and rejects garbage", () => {
    expect(domainFromUrl("careers.macadam.app")).toBe("macadam.app");
    expect(domainFromUrl("")).toBeNull();
    expect(domainFromUrl(null)).toBeNull();
    expect(domainFromUrl("localhost")).toBeNull();
  });
});

describe("deriveLogoDomain", () => {
  it("careers URL wins over website", () => {
    expect(deriveLogoDomain({ careersUrl: "https://careers.macadam.app", website: "https://other.com" })).toBe(
      "macadam.app",
    );
  });

  it("falls back to website when the careers URL is hosted-ATS", () => {
    expect(deriveLogoDomain({ careersUrl: "https://macadam.teamtailor.com", website: "https://macadam.app" })).toBe(
      "macadam.app",
    );
  });

  it("returns null (never guesses) when neither URL is usable", () => {
    expect(deriveLogoDomain({ careersUrl: "https://boards.greenhouse.io/x", website: null })).toBeNull();
    expect(deriveLogoDomain({})).toBeNull();
  });
});

describe("resolveLogoDomain — the full fallback order (issue #153 item B1)", () => {
  it("careers_url/website still wins, unchanged, and never touches applyUrls", () => {
    expect(
      resolveLogoDomain({
        careersUrl: "https://careers.macadam.app",
        website: null,
        applyUrls: ["https://boards.greenhouse.io/wrong/jobs/1"],
      }),
    ).toEqual({ domain: "macadam.app", derivedWebsite: null });
  });

  it("a company with NEITHER careers_url nor website falls to its own apply-URL host", () => {
    expect(
      resolveLogoDomain({
        careersUrl: null,
        website: null,
        applyUrls: ["https://boards.greenhouse.io/acme/jobs/1", "https://acme.io/careers/pm"],
      }),
    ).toEqual({ domain: "acme.io", derivedWebsite: "https://acme.io" });
  });

  it("hosted-ATS apply URLs never resolve — the wrong domain is worse than none", () => {
    expect(
      resolveLogoDomain({
        careersUrl: null,
        website: null,
        applyUrls: ["https://jobs.lever.co/acme/1", "https://www.linkedin.com/jobs/view/1"],
      }),
    ).toEqual({ domain: null, derivedWebsite: null });
  });

  it("a website on file that just didn't resolve is never overridden by an apply-URL guess", () => {
    expect(
      resolveLogoDomain({
        careersUrl: null,
        website: "https://boards.greenhouse.io/not-a-real-site", // deliberately unresolvable
        applyUrls: ["https://acme.io/careers/pm"],
      }),
    ).toEqual({ domain: null, derivedWebsite: null });
  });

  it("no applyUrls at all is the same as none resolving", () => {
    expect(resolveLogoDomain({ careersUrl: null, website: null, applyUrls: [] })).toEqual({
      domain: null,
      derivedWebsite: null,
    });
    expect(resolveLogoDomain({})).toEqual({ domain: null, derivedWebsite: null });
  });
});
