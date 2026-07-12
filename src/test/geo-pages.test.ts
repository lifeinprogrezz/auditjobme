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
  renderSnippets,
  snippetFor,
  marketPulseSentence,
  employmentTypeOf,
  logoImageUrl,
  jsonLdScript,
  MIN_ROLES_PER_PAGE,
  MAX_JOBPOSTINGS,
  POSTING_VALID_DAYS,
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

// ── market-pulse generation (#46: content generated from the dataplane) ────────

describe("buildPages market-pulse stats", () => {
  it("counts distinct sources and a mutually-exclusive freshness mix", () => {
    const jobs = [
      job({ id: "a", company: "Co0", company_id: "co0", source: "greenhouse", posted_at: daysAgo(2) }), // this week
      job({ id: "b", company: "Co1", company_id: "co1", source: "lever", posted_at: daysAgo(6) }), // this week
      job({ id: "c", company: "Co2", company_id: "co2", source: "greenhouse", posted_at: daysAgo(20) }), // this month
      job({ id: "d", company: "Co3", company_id: "co3", source: "ashby", posted_at: daysAgo(50) }), // older
      job({ id: "e", company: "Co4", company_id: "co4", source: null, posted_at: null }), // undated
    ];
    const [p] = buildPages(input(jobs), opts);
    expect(p.sourceCount).toBe(3); // greenhouse, lever, ashby (null excluded)
    expect(p.freshness).toEqual({ last7: 2, recent: 1, older: 1, undated: 1 });
    expect(p.freshness.last7).toBe(p.postedLast7); // the two agree
  });

  it("treats a future-dated posting as undated (never a fresh count)", () => {
    const jobs = [
      ...berlinPool(5),
      job({ id: "future", company: "Zeta", company_id: "zeta", posted_at: daysAgo(-5) }),
    ];
    const [p] = buildPages(input(jobs), opts);
    expect(p.freshness.undated).toBe(1);
    expect(p.freshness.last7).toBe(5);
  });
});

describe("marketPulseSentence (honest prose)", () => {
  it("leads with the top employer and only mentions freshness buckets that exist", () => {
    const jobs = [
      job({ id: "a", company: "BigCo", company_id: "big", posted_at: daysAgo(2) }),
      job({ id: "b", company: "BigCo", company_id: "big", posted_at: daysAgo(3) }),
      ...berlinPool(4).map((j) => ({ ...j, posted_at: daysAgo(2) })),
    ];
    const [p] = buildPages(input(jobs), opts);
    const s = marketPulseSentence(p);
    expect(s).toContain("BigCo is hiring the most, with 2 open roles.");
    expect(s).toContain("posted this week");
    expect(s).not.toContain("last month"); // no 8-30d roles in this pool
    expect(s).not.toContain("open longer"); // no >30d roles
    expect(s).not.toContain("—"); // no em-dashes in user-facing copy
  });

  it("omits the freshness clause entirely when every role is undated", () => {
    const jobs = berlinPool(5).map((j) => ({ ...j, posted_at: null }));
    const [p] = buildPages(input(jobs), opts);
    const s = marketPulseSentence(p);
    expect(s).toContain("is hiring the most");
    expect(s).not.toMatch(/posted this week|last month|open longer/);
  });
});

describe("renderPage market-pulse section", () => {
  it("renders a Market pulse heading with freshness + source chips", () => {
    const jobs = [
      job({ id: "a", company: "Co0", company_id: "co0", source: "greenhouse", posted_at: daysAgo(2) }),
      job({ id: "b", company: "Co1", company_id: "co1", source: "lever", posted_at: daysAgo(20) }),
      ...berlinPool(4).map((j, i) => ({ ...j, id: `p${i}`, source: "greenhouse", posted_at: daysAgo(2) })),
    ];
    const [page] = buildPages(input(jobs), opts);
    const html = renderPage(page, [], new Map(), { origin: "https://auditjob.me", generatedAt: GENERATED_AT });
    expect(html).toContain("<h2>Market pulse</h2>");
    expect(html).toContain("This week ·");
    expect(html).toContain("This month ·");
    expect(html).toContain("2 sources"); // greenhouse + lever
  });

  it("shows only the Undated chip (no fabricated fresh counts) when all roles are undated", () => {
    const jobs = berlinPool(5).map((j) => ({ ...j, posted_at: null, source: "greenhouse" }));
    const [page] = buildPages(input(jobs), opts);
    const html = renderPage(page, [], new Map(), { origin: "https://auditjob.me", generatedAt: GENERATED_AT });
    expect(html).toContain("Undated · 5");
    expect(html).not.toContain("This week ·");
    expect(html).not.toContain("This month ·");
  });
});

// ── #54 GEO / structured-data honesty ─────────────────────────────────────────

describe("logoImageUrl (real image URL or omit)", () => {
  it("maps a bare domain to an icon.horse image URL", () => {
    expect(logoImageUrl("stripe.com")).toBe("https://icon.horse/icon/stripe.com");
  });
  it("tolerates an accidental scheme/path/www in the dataplane value", () => {
    expect(logoImageUrl("https://stripe.com/careers")).toBe("https://icon.horse/icon/stripe.com");
    expect(logoImageUrl("www.stripe.com")).toBe("https://icon.horse/icon/stripe.com");
  });
  it("returns null for a missing or non-domain value (caller omits the property)", () => {
    expect(logoImageUrl(null)).toBeNull();
    expect(logoImageUrl(undefined)).toBeNull();
    expect(logoImageUrl("notadomain")).toBeNull();
    expect(logoImageUrl("")).toBeNull();
  });
});

describe("employmentTypeOf (derive from title signals only, never assume FULL_TIME)", () => {
  it("derives from explicit signals", () => {
    expect(employmentTypeOf("Product Manager Intern")).toBe("INTERN");
    expect(employmentTypeOf("PM Internship (6 months)")).toBe("INTERN");
    expect(employmentTypeOf("Working Student, Product")).toBe("PART_TIME");
    expect(employmentTypeOf("Part-time Product Manager")).toBe("PART_TIME");
    expect(employmentTypeOf("Interim Head of Product")).toBe("TEMPORARY");
    expect(employmentTypeOf("Product Manager (Contractor)")).toBe("CONTRACTOR");
    expect(employmentTypeOf("Freelance Product Designer")).toBe("CONTRACTOR");
  });
  it("returns null when no signal is present (no FULL_TIME fabrication)", () => {
    expect(employmentTypeOf("Product Manager")).toBeNull();
    expect(employmentTypeOf("Senior Product Manager, Payments")).toBeNull();
  });
  it("does not false-positive on lookalike words", () => {
    expect(employmentTypeOf("Product Manager, Internal Tools")).toBeNull(); // "internal" ≠ intern
    expect(employmentTypeOf("Contracts Manager")).toBeNull(); // a role about contracts, not a contractor
  });
});

describe("JobPosting JSON-LD enrichment (#54)", () => {
  const companies: DataplaneCompany[] = [
    {
      slug: "acme",
      logo_domain: "acme.com",
      website: "https://acme.example",
      lat: null, lng: null, sector: null, stage: null, headcount_bucket: null,
      hq_city: null, hq_country: null, linkedin_url: null, description: null,
      founded_year: null, uk_sponsor_status: null,
    },
  ];
  const map = new Map(companies.map((c) => [c.slug, c]));

  function postingsFrom(html: string) {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
      JSON.parse(m[1].replace(/\\u003c/g, "<")),
    );
    const itemList = blocks.find((b) => b["@type"] === "ItemList");
    return itemList.itemListElement.map((e: { item: Record<string, unknown> }) => e.item);
  }

  it("emits a real image logo (icon.horse) and never the company website as logo", () => {
    const jobs = berlinPool(5).map((j) => ({ ...j, company: "Acme", company_id: "acme" }));
    const [page] = buildPages(input(jobs), opts);
    const html = renderPage(page, [], map, { origin: "https://auditjob.me", generatedAt: GENERATED_AT });
    const [jp] = postingsFrom(html);
    const org = jp.hiringOrganization as Record<string, unknown>;
    expect(org.logo).toBe("https://icon.horse/icon/acme.com");
    expect(org.sameAs).toBe("https://acme.example"); // website lives in sameAs, not logo
    expect(org.logo).not.toBe("https://acme.com"); // never the bare website
  });

  it("omits logo entirely when the company has no logo_domain", () => {
    const noLogo: DataplaneCompany[] = [{ ...companies[0], logo_domain: null }];
    const jobs = berlinPool(5).map((j) => ({ ...j, company: "Acme", company_id: "acme" }));
    const [page] = buildPages(input(jobs), opts);
    const html = renderPage(page, [], new Map(noLogo.map((c) => [c.slug, c])), {
      origin: "https://auditjob.me",
      generatedAt: GENERATED_AT,
    });
    const [jp] = postingsFrom(html);
    expect((jp.hiringOrganization as Record<string, unknown>).logo).toBeUndefined();
  });

  it("adds validThrough = datePosted + the documented window", () => {
    const jobs = berlinPool(5).map((j) => ({ ...j, posted_at: "2026-07-01T00:00:00.000Z" }));
    const [page] = buildPages(input(jobs), opts);
    const html = renderPage(page, [], new Map(), { origin: "https://auditjob.me", generatedAt: GENERATED_AT });
    const [jp] = postingsFrom(html);
    const expected = new Date(Date.parse("2026-07-01T00:00:00.000Z") + POSTING_VALID_DAYS * 86_400_000).toISOString();
    expect(jp.validThrough).toBe(expected);
  });

  it("derives employmentType where the title signals it, omits it otherwise", () => {
    const jobs = [
      job({ id: "intern", company: "Co0", company_id: "co0", title: "Product Manager Intern" }),
      ...berlinPool(4),
    ];
    const [page] = buildPages(input(jobs), opts);
    const html = renderPage(page, [], new Map(), { origin: "https://auditjob.me", generatedAt: GENERATED_AT });
    const postings = postingsFrom(html);
    const internJp = postings.find((p: Record<string, unknown>) => p.title === "Product Manager Intern");
    expect(internJp.employmentType).toBe("INTERN");
    const plainJp = postings.find((p: Record<string, unknown>) => p.title === "Product Manager 0");
    expect(plainJp.employmentType).toBeUndefined();
  });

  it("emits baseSalary ONLY from a stated band, never fabricated", () => {
    const stated = { salary_min: 70000, salary_max: 90000, salary_currency: "EUR", salary_period: "year" };
    const jobs = [
      job({ id: "paid", company: "PaidCo", company_id: "paidco", title: "Paid PM", extraction: stated }),
      ...berlinPool(4), // extraction: null → no band
    ];
    const [page] = buildPages(input(jobs), opts);
    const html = renderPage(page, [], new Map(), { origin: "https://auditjob.me", generatedAt: GENERATED_AT });
    const postings = postingsFrom(html);
    const withBand = postings.filter((p: Record<string, unknown>) => p.baseSalary);
    expect(withBand).toHaveLength(1); // only the one stated band, the other 4 omit it
    const bs = withBand[0].baseSalary as Record<string, unknown>;
    expect(bs.currency).toBe("EUR");
    const val = bs.value as Record<string, unknown>;
    expect(val.minValue).toBe(70000);
    expect(val.maxValue).toBe(90000);
  });

  it("documents the JobPosting ItemList cap and enforces it at MAX_JOBPOSTINGS", () => {
    const many = Array.from({ length: MAX_JOBPOSTINGS + 12 }, (_, i) =>
      job({ id: `m${i}`, company: `Co${i}`, company_id: `co${i}`, posted_at: daysAgo((i % 20) + 1) }),
    );
    const [page] = buildPages(input(many), opts);
    const html = renderPage(page, [], new Map(), { origin: "https://auditjob.me", generatedAt: GENERATED_AT });
    expect(html).toContain(`per-page cap ${MAX_JOBPOSTINGS}`); // cap documented in the page
    expect(html).toContain(`JobPosting ItemList: ${MAX_JOBPOSTINGS} of ${MAX_JOBPOSTINGS + 12} dated roles`);
    const postings = postingsFrom(html);
    expect(postings).toHaveLength(MAX_JOBPOSTINGS); // enforced
  });
});

// ── snippets artifact (dist/snippets.json) ────────────────────────────────────

describe("snippets artifact", () => {
  it("renderSite writes snippets.json", () => {
    const files = renderSite(input(berlinPool(6)), opts);
    expect(files.map((f) => f.path)).toContain("snippets.json");
  });

  it("snippetFor carries real numbers, the URL, warm voice and no em-dashes", () => {
    const [p] = buildPages(input(berlinPool(6)), opts);
    const snip = snippetFor(p, "2026-07-12", "https://auditjob.me");
    expect(snip.roles).toBe(6);
    expect(snip.companies).toBe(6);
    expect(snip.url).toBe("https://auditjob.me/jobs/berlin/product/");
    expect(snip.short).toContain("6 Product Manager roles live in Berlin");
    expect(snip.short).toContain("https://auditjob.me/jobs/berlin/product/");
    expect(snip.text).toContain("As of 12 July 2026");
    expect(snip.text).toContain("Every one is scored against your CV, free.");
    expect(snip.text).not.toContain("—");
    expect(snip.short).not.toContain("—");
  });

  it("omits any salary claim from the snippet when extraction is empty", () => {
    const [p] = buildPages(input(berlinPool(6)), opts);
    const snip = snippetFor(p, "2026-07-12", "https://auditjob.me");
    expect(snip.salary).toBeNull();
    expect(snip.text).not.toMatch(/median/i);
  });

  it("carries a real median only when ≥5 roles state one currency band", () => {
    const band = { salary_min: 80000, salary_currency: "EUR", salary_period: "year" };
    const jobs = berlinPool(6).map((j) => ({ ...j, extraction: band }));
    const [p] = buildPages(input(jobs), opts);
    const snip = snippetFor(p, "2026-07-12", "https://auditjob.me");
    expect(snip.salary).toEqual({ currency: "EUR", median: 80000 });
    expect(snip.text).toContain("median advertised base is €80,000");
  });

  it("renderSnippets is valid, deterministic JSON with a stable count", () => {
    const pages = buildPages(input(berlinPool(6)), opts);
    const ctx = { origin: "https://auditjob.me", generatedAt: GENERATED_AT };
    const a = renderSnippets(pages, ctx);
    const b = renderSnippets(pages, ctx);
    expect(a).toBe(b); // byte-stable
    const parsed = JSON.parse(a);
    expect(parsed.site).toBe("auditjob.me");
    expect(parsed.count).toBe(pages.length);
    expect(parsed.snippets).toHaveLength(pages.length);
    expect(parsed.snippets[0].city).toBe("Berlin");
  });

  it("emits an empty snippets array (not a crash) when no page qualifies", () => {
    const files = renderSite(input(berlinPool(2)), opts); // below doorway threshold
    const snippets = files.find((f) => f.path === "snippets.json")!.content;
    const parsed = JSON.parse(snippets);
    expect(parsed.count).toBe(0);
    expect(parsed.snippets).toEqual([]);
  });
});
