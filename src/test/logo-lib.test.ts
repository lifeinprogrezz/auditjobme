// Pins logo-domain derivation (scripts/logo-lib.mjs), issue #68 item 4.
// Contract: derive ONLY from URLs the company owns (careers_url, then website);
// hosted-ATS/platform hosts yield null — a wrong domain renders a WRONG logo.
import { describe, expect, it } from "vitest";
import { deriveLogoDomain, domainFromUrl } from "../../scripts/logo-lib.mjs";

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
