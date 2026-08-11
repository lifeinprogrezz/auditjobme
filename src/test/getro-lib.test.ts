// Pins the Getro VC-board row-integrity logic (scripts/getro-lib.mjs), issue #68
// item 2. Recorded decision: keep ATS-direct URLs; for LinkedIn URLs re-attribute
// the company from the URL slug (the Beekeeper→LumApps / Passfort→Moody's class);
// drop rows where no company is recoverable.
import { describe, expect, it } from "vitest";
import {
  companyFromSlug,
  parseLinkedInJobUrl,
  resolveGetroJob,
  resolveGetroJobs,
  sameCompany,
} from "../../scripts/getro-lib.mjs";

const base = { title: "Product Manager", location: "London", source: "vc:getro:ef" };

describe("parseLinkedInJobUrl", () => {
  it("returns null for non-LinkedIn URLs (ATS-direct passes through)", () => {
    expect(parseLinkedInJobUrl("https://jobs.lever.co/acme/123")).toBeNull();
    expect(parseLinkedInJobUrl("not a url")).toBeNull();
  });

  it("extracts id + company slug from the slugged form", () => {
    const p = parseLinkedInJobUrl(
      "https://www.linkedin.com/jobs/view/senior-product-manager-at-lumapps-4123456789?refId=x&trk=y",
    );
    expect(p).toEqual({ id: "4123456789", companySlug: "lumapps" });
  });

  it("keeps multi-word company slugs intact", () => {
    const p = parseLinkedInJobUrl("https://www.linkedin.com/jobs/view/product-manager-at-moody-s-corporation-4200000001");
    expect(p?.companySlug).toBe("moody-s-corporation");
  });

  it("numeric-only form has no company slug", () => {
    expect(parseLinkedInJobUrl("https://www.linkedin.com/jobs/view/4123456789")).toEqual({
      id: "4123456789",
      companySlug: null,
    });
  });
});

describe("sameCompany / companyFromSlug", () => {
  it("matches apostrophe/hyphen variants (Moody's ≈ moody-s)", () => {
    expect(sameCompany(companyFromSlug("moody-s"), "Moody's")).toBe(true);
    expect(sameCompany(companyFromSlug("lumapps"), "LumApps")).toBe(true);
  });
  it("different companies do not match", () => {
    expect(sameCompany(companyFromSlug("lumapps"), "Beekeeper")).toBe(false);
    expect(sameCompany("", "")).toBe(false);
  });
});

describe("resolveGetroJob", () => {
  it("keeps ATS-direct rows untouched", () => {
    const job = { ...base, company: "Beekeeper", url: "https://jobs.lever.co/beekeeper/abc-123" };
    expect(resolveGetroJob(job)).toEqual({ action: "keep", job });
  });

  it("re-attributes the Beekeeper→LumApps class from the URL slug", () => {
    const job = {
      ...base,
      company: "Beekeeper",
      url: "https://www.linkedin.com/jobs/view/senior-product-manager-at-lumapps-4123456789?refId=abc",
    };
    const r = resolveGetroJob(job);
    expect(r.action).toBe("reattribute");
    expect(r.job.company).toBe("Lumapps");
    expect(r.job.url).toBe("https://www.linkedin.com/jobs/view/4123456789");
  });

  it("re-attributes Passfort→Moody's", () => {
    const job = {
      ...base,
      company: "Passfort",
      url: "https://www.linkedin.com/jobs/view/product-manager-kyc-at-moody-s-corporation-4200000001",
    };
    const r = resolveGetroJob(job);
    expect(r.action).toBe("reattribute");
    expect(r.job.company).toBe("Moody S Corporation");
  });

  it("keeps a LinkedIn row whose slug CONFIRMS the claimed company (URL canonicalized)", () => {
    const job = {
      ...base,
      company: "LumApps",
      url: "https://www.linkedin.com/jobs/view/product-manager-at-lumapps-4123456789?trk=feed",
    };
    const r = resolveGetroJob(job);
    expect(r.action).toBe("keep");
    expect(r.job.url).toBe("https://www.linkedin.com/jobs/view/4123456789");
  });

  it("drops LinkedIn rows with no recoverable company", () => {
    const job = { ...base, company: "Beekeeper", url: "https://www.linkedin.com/jobs/view/4123456789" };
    expect(resolveGetroJob(job)).toEqual({ action: "drop", reason: "linkedin-url-no-company-slug" });
  });
});

describe("resolveGetroJobs", () => {
  it("partitions a batch and counts each outcome", () => {
    const rows = [
      { ...base, company: "Acme", url: "https://jobs.ashbyhq.com/acme/uuid" },
      { ...base, company: "Beekeeper", url: "https://www.linkedin.com/jobs/view/pm-at-lumapps-4123456789" },
      { ...base, company: "Passfort", url: "https://www.linkedin.com/jobs/view/4200000001" },
    ];
    const out = resolveGetroJobs(rows) as {
      kept: number;
      reattributed: number;
      dropped: number;
      jobs: Array<{ company: string }>;
    };
    expect(out.kept).toBe(1);
    expect(out.reattributed).toBe(1);
    expect(out.dropped).toBe(1);
    expect(out.jobs).toHaveLength(2);
    expect(out.jobs[1].company).toBe("Lumapps");
  });
});
