import { describe, it, expect } from "vitest";
import {
  slugify,
  verticalOf,
  buildPages,
  leadSentence,
  renderPage,
  renderSite,
  renderSitemap,
  renderLlmsTxt,
  jsonLdScript,
  MIN_ROLES_PER_PAGE,
  type SiteInput,
} from "@/lib/geo-pages";
import type { DataplaneCompany } from "@/lib/dataplane";

// Fixed clock so "posted this week" + dates are deterministic.
const NOW = Date.parse("2026-07-12T00:00:00Z");
const GENERATED_AT = "2026-07-12T05:30:00.000Z";
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function job(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "j" + Math.random().toString(36).slice(2),
    company: "Acme",
    title: "Product Manager",
    url: "https://acme.example/careers/1",
    location: "Berlin, Germany",
    remote: false,
    source: "greenhouse",
    seniority: "pm",
    posted_at: daysAgo(3),
    company_id: "acme",
    extraction: null,
    role_family: null,
    workplace: null,
    ...over,
  } as unknown as SiteInput["jobs"][number];
}

// N Berlin PM jobs across distinct companies (default meets the doorway threshold).
function berlinPool(n = MIN_ROLES_PER_PAGE, city = "Berlin, Germany") {
  return Array.from({ length: n }, (_, i) =>
    job({ id: `b${i}`, company: `Co${i}`, company_id: `co${i}`, location: city, title: `Product Manager ${i}` }),
  );
}

const companies: DataplaneCompany[] = [];
const input = (jobs: SiteInput["jobs"], generated_at = GENERATED_AT): SiteInput => ({
  jobs,
  companies,
  generated_at,
});
const opts = { origin: "https://auditjob.me", now: NOW };

describe("slugify", () => {
  it("folds diacritics and non-alphanumerics to hyphen slugs", () => {
    expect(slugify("The Hague")).toBe("the-hague");
    expect(slugify("Kraków")).toBe("krakow");
    expect(slugify("Málaga")).toBe("malaga");
    expect(slugify("Cluj-Napoca")).toBe("cluj-napoca");
  });
});

describe("verticalOf", () => {
  it("maps null role_family to the Product Manager vertical (PM-wedge)", () => {
    expect(verticalOf({ role_family: null })).toEqual({ slug: "product", label: "Product Manager" });
  });
  it("slugifies a real role_family when the engine goes all-vertical", () => {
    expect(verticalOf({ role_family: "Data Analyst" })).toEqual({ slug: "data-analyst", label: "Data Analyst" });
  });
});

describe("buildPages doorway guard", () => {
  it("emits a page only at or above the role threshold", () => {
    expect(buildPages(input(berlinPool(MIN_ROLES_PER_PAGE - 1)), opts)).toHaveLength(0);
    const pages = buildPages(input(berlinPool(MIN_ROLES_PER_PAGE)), opts);
    expect(pages).toHaveLength(1);
    expect(pages[0].path).toBe("/jobs/berlin/product/");
    expect(pages[0].file).toBe("jobs/berlin/product/index.html");
  });

  it("drops remote-only / unresolved-city jobs (no city page)", () => {
    const jobs = [...berlinPool(), ...Array.from({ length: 6 }, (_, i) => job({ id: `r${i}`, location: "Remote (EU)" }))];
    const pages = buildPages(input(jobs), opts);
    expect(pages.map((p) => p.city)).toEqual(["Berlin"]);
  });

  it("computes honest stats: company count, freshness, top employers", () => {
    const jobs = [
      ...berlinPool(5),
      job({ id: "old", company: "Co0", company_id: "co0", posted_at: daysAgo(40) }), // stale, same co
    ];
    const [p] = buildPages(input(jobs), opts);
    expect(p.jobs.length).toBe(6);
    expect(p.companyCount).toBe(5); // 5 distinct companies
    expect(p.postedLast7).toBe(5); // the stale one is excluded
    expect(p.topEmployers[0]).toEqual({ company: "Co0", count: 2 });
  });

  it("is deterministic / byte-stable across two builds", () => {
    const a = renderSite(input(berlinPool(7)), opts);
    const b = renderSite(input(berlinPool(7)), opts);
    expect(a).toEqual(b);
  });
});

describe("leadSentence (GEO self-citing lead)", () => {
  it("is dated, sourced, and pluralizes honestly", () => {
    const [p] = buildPages(input(berlinPool(5)), opts);
    const s = leadSentence(p, "2026-07-12");
    expect(s).toContain("As of 12 July 2026");
    expect(s).toContain("5 Product Manager roles in Berlin");
    expect(s).toContain("across 5 companies on auditjob.me");
    expect(s).toContain("posted in the last 7 days");
    expect(s).not.toContain("—"); // no em-dashes in user-facing copy
  });

  it("never invents a salary line when extraction is empty", () => {
    const [p] = buildPages(input(berlinPool(5)), opts);
    expect(leadSentence(p, "2026-07-12")).not.toMatch(/median/i);
  });
});

describe("renderPage HTML + JSON-LD", () => {
  const jobs = [
    ...berlinPool(5),
    job({ id: "nodate", company: "NoDate", company_id: "nd", posted_at: null }),
  ];
  const [page] = buildPages(input(jobs), opts);
  const html = renderPage(page, [], new Map(), { origin: "https://auditjob.me", generatedAt: GENERATED_AT });

  it("emits a real HTML document with the H1 and canonical", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<h1>Product Manager jobs in Berlin</h1>");
    expect(html).toContain('<link rel="canonical" href="https://auditjob.me/jobs/berlin/product/">');
    expect(html).toContain('<meta name="robots" content="index,follow">');
  });

  it("carries Organization + JobPosting JSON-LD, all valid JSON", () => {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
      JSON.parse(m[1].replace(/\\u003c/g, "<")),
    );
    const types = blocks.map((b) => b["@type"]);
    expect(types).toContain("Organization");
    expect(types).toContain("BreadcrumbList");
    expect(types).toContain("ItemList");
    const itemList = blocks.find((b) => b["@type"] === "ItemList");
    const postings = itemList.itemListElement.map((e: { item: { "@type": string } }) => e.item);
    expect(postings.length).toBe(5); // the null-datePosted job is excluded from JSON-LD
    for (const jp of postings) {
      expect(jp["@type"]).toBe("JobPosting");
      expect(typeof jp.title).toBe("string");
      expect(typeof jp.description).toBe("string");
      expect(typeof jp.datePosted).toBe("string");
      expect(jp.hiringOrganization["@type"]).toBe("Organization");
      expect(jp.jobLocation.address.addressLocality).toBe("Berlin");
    }
  });

  it("escapes angle brackets in JSON-LD so a value can't break the script tag", () => {
    const evil = jsonLdScript({ name: "</script><script>alert(1)</script>" });
    expect(evil).not.toContain("</script><script>alert");
    expect(evil).toContain("\\u003c");
  });
});

describe("renderSite bundle", () => {
  const files = renderSite(input(berlinPool(6)), opts);
  const paths = files.map((f) => f.path);

  it("emits the city page, the /jobs/ hub, sitemap.xml and llms.txt", () => {
    expect(paths).toContain("jobs/berlin/product/index.html");
    expect(paths).toContain("jobs/index.html");
    expect(paths).toContain("sitemap.xml");
    expect(paths).toContain("llms.txt");
  });

  it("sitemap lists home, hub and every city page", () => {
    const xml = files.find((f) => f.path === "sitemap.xml")!.content;
    expect(xml).toContain("<loc>https://auditjob.me/</loc>");
    expect(xml).toContain("<loc>https://auditjob.me/jobs/</loc>");
    expect(xml).toContain("<loc>https://auditjob.me/jobs/berlin/product/</loc>");
    expect(xml).toContain("<?xml");
  });

  it("llms.txt is a dated, self-citing agent index", () => {
    const txt = renderLlmsTxt(buildPages(input(berlinPool(6)), opts), {
      origin: "https://auditjob.me",
      generatedAt: GENERATED_AT,
    });
    expect(txt).toContain("# auditjob.me");
    expect(txt).toContain("Last updated 2026-07-12");
    expect(txt).toContain("[Product Manager jobs in Berlin](https://auditjob.me/jobs/berlin/product/)");
  });

  it("always emits a valid sitemap even with zero qualifying pages", () => {
    const files0 = renderSite(input(berlinPool(2)), opts); // below threshold
    const xml = files0.find((f) => f.path === "sitemap.xml")!.content;
    expect(xml).toContain("<loc>https://auditjob.me/</loc>");
    expect(files0.some((f) => f.path === "jobs/index.html")).toBe(false); // no thin hub
  });
});

describe("malformed-artifact resilience (deploy never breaks)", () => {
  // Prod Vercel builds fetch a daily-refreshed Storage artifact live; one bad
  // upload must never brick the build. isDataplane() (dataplane.test.ts) rejects
  // missing jobs/companies arrays before renderSite sees them; here we pin the
  // one malformed shape that passes isDataplane() — an unparseable generated_at
  // string — which used to crash isoDate()'s new Date(NaN).toISOString().
  it("renders without throwing when generated_at is unparseable, dates fall back to now", () => {
    expect(() => renderSite(input(berlinPool(6), "not-a-date"), opts)).not.toThrow();
    const files = renderSite(input(berlinPool(6), "not-a-date"), opts);
    const xml = files.find((f) => f.path === "sitemap.xml")!.content;
    expect(xml).toContain("<lastmod>2026-07-12</lastmod>"); // opts.now, not NaN
    const page = files.find((f) => f.path === "jobs/berlin/product/index.html")!.content;
    expect(page).toContain("As of 12 July 2026");
    expect(page).not.toContain("Invalid Date");
  });

  it("tolerates a null generated_at (baseline path)", () => {
    expect(() => renderSite(input(berlinPool(6), null as unknown as string), opts)).not.toThrow();
  });
});

describe("sitemap lastmod", () => {
  it("uses the freshest job date per page", () => {
    const jobs = berlinPool(5).map((j, i) => (i === 0 ? { ...j, posted_at: "2026-07-01T00:00:00Z" } : j));
    const pages = buildPages(input(jobs), opts);
    const xml = renderSitemap(pages, { origin: "https://auditjob.me", generatedAt: GENERATED_AT });
    // freshest of the pool is 3 days ago (2026-07-09), not the 2026-07-01 outlier
    expect(xml).toContain("<lastmod>2026-07-09</lastmod>");
  });
});
