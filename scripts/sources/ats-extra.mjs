/**
 * Extra ATS source descriptors for the daily scrape: SmartRecruiters, Workable,
 * Workday, and Factorial. Mirrors the `{ company, run }` shape that
 * scripts/scrape.mjs already uses for Greenhouse/Lever/Ashby; the orchestrator
 * spreads `sources` (exported below) into its SOURCES list.
 *
 *   import { sources } from "./sources/ats-extra.mjs";
 *   const SOURCES = [...existing, ...sources];
 *
 * Each `run()` resolves to an array of normalized job objects:
 *   { company, title, url, location, remote, source, posted_at, jd_text, seniority }
 * filtered through the shared job-filters (isPM(title) && isEU(location)).
 *
 * API shapes verified against career-ops scan.mjs (the engine these slugs come
 * from). The SmartRecruiters / Workable / Workday LIST endpoints do NOT carry a
 * job description, so jd_text is null for those (title-filter path only — the
 * web app's classifier can cold-fetch the JD later if it wants). Factorial is
 * SSR: the detail page embeds a schema.org JobPosting with the description, so
 * its PM matches DO get jd_text.
 */
import { isPM, isEU, inferSeniority, stripHtml } from "../job-filters.mjs";

const fetchOpts = (extra = {}) => ({ signal: AbortSignal.timeout(20000), ...extra }); // fresh signal per call
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_PAGES = 20; // hard cap on paginated fetches per board (matches scan.mjs)

const toIso = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ── Company lists (slugs/tenants pulled from career-ops portals.yml, plus a
// few well-known public boards on the same ATS). Display names cleaned up;
// where a slug had no clean name in portals.yml it's title-cased here. ───────

// SmartRecruiters: GET api.smartrecruiters.com/v1/companies/{slug}/postings
const SMARTRECRUITERS = [
  { company: "Wise", slug: "Wise" },
  { company: "Palantir", slug: "Palantir" },
  { company: "ServiceNow", slug: "ServiceNow" },
  { company: "Visa", slug: "Visa" },
  { company: "Canva", slug: "canva" },
  { company: "Scalable Capital", slug: "ScalableGmbH" },
  { company: "Delivery Hero", slug: "DeliveryHero" },
  { company: "Bosch", slug: "BoschGroup" },
  { company: "Ubisoft", slug: "Ubisoft2" },
  { company: "McDonald's", slug: "McDonalds" },
];

// Workable: POST apply.workable.com/api/v3/accounts/{slug}/jobs
const WORKABLE = [
  { company: "FairMoney", slug: "fairmoney" },
  { company: "Hugging Face", slug: "huggingface" },
  { company: "Runware", slug: "runware" },
  { company: "Tyk", slug: "tyk-technologies" },
  { company: "WorkMotion", slug: "workmotion" },
  { company: "Dreamdata", slug: "dreamdata" },
  { company: "Exoticca", slug: "exoticca" },
  { company: "Perlego", slug: "perlego" },
  { company: "Plum", slug: "withplum" },
  { company: "Uncapped", slug: "uncapped" },
  { company: "Usercentrics", slug: "usercentrics" },
  { company: "Mondu", slug: "mondu" },
  { company: "Flowdesk", slug: "flowdesk" },
  { company: "Booksy", slug: "booksy-1" },
  { company: "Carmoola", slug: "carmoola-1" },
  { company: "Cleafy", slug: "cleafy" },
  { company: "Ferryhopper", slug: "ferryhopper" },
  { company: "Fuse Energy", slug: "fuseenergy" },
  { company: "Hellas Direct", slug: "hellasdirect" },
  { company: "Neurolabs", slug: "neurolabs" },
  { company: "Prosapient", slug: "prosapient" },
  { company: "Ukio", slug: "ukio" },
  { company: "Updraft", slug: "updraft" },
  { company: "Zodia Custody", slug: "zodia-custody" },
  { company: "Vitesse", slug: "vitesse-psp" },
];

// Workday: POST {tenant}.{subdomain}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
const WORKDAY = [
  { company: "Salesforce", tenant: "salesforce", site: "External_Career_Site", subdomain: "wd12" },
  { company: "Adobe", tenant: "adobe", site: "external_experienced", subdomain: "wd5" },
  { company: "NVIDIA", tenant: "nvidia", site: "NVIDIAExternalCareerSite", subdomain: "wd5" },
  { company: "Workday", tenant: "workday", site: "Workday", subdomain: "wd5" },
];

// ── Fetchers ────────────────────────────────────────────────────────────────

async function fetchSmartRecruiters(b) {
  const all = [];
  let offset = 0;
  let total = Infinity; // pinned to the FIRST page's count; later pages can wrongly report 0
  let page = 0;
  while (offset < total && page < MAX_PAGES) {
    const res = await fetch(
      `https://api.smartrecruiters.com/v1/companies/${b.slug}/postings?limit=100&offset=${offset}`,
      fetchOpts()
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (page === 0) total = data.totalFound || 0;
    const content = data.content || [];
    if (!content.length) break; // empty page → done (don't trust a flaky total)
    for (const j of content) {
      const loc = j.location || {};
      const location =
        [loc.city, loc.region, loc.country].filter(Boolean).join(", ") || null;
      all.push({
        company: b.company,
        title: j.name || "",
        url: `https://jobs.smartrecruiters.com/${b.slug}/${j.id}`,
        location,
        remote: !!loc.remote || /remote/i.test(location || "") || /remote/i.test(j.name || ""),
        source: "smartrecruiters",
        posted_at: toIso(j.releasedDate),
        jd_text: null, // list endpoint carries no description
        seniority: inferSeniority(j.name),
      });
    }
    offset += 100;
    page++;
  }
  return all.filter((j) => isPM(j.title) && isEU(j.location));
}

async function fetchWorkable(b) {
  const url = `https://apply.workable.com/api/v3/accounts/${b.slug}/jobs`;
  const all = [];
  let token = null;
  let page = 0;
  while (page < MAX_PAGES) {
    const res = await fetch(
      url,
      fetchOpts({
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(token ? { token } : {}),
      })
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (page === 0 && !(data.total > 0)) return []; // gate on total>0
    for (const j of data.results || []) {
      const loc = j.location || {};
      const location = j.remote
        ? "Remote"
        : [loc.city, loc.region, loc.country].filter(Boolean).join(", ") || null;
      all.push({
        company: b.company,
        title: j.title || "",
        url: j.shortcode ? `https://apply.workable.com/${b.slug}/j/${j.shortcode}/` : "",
        location,
        remote: !!j.remote || /remote/i.test(location || "") || /remote/i.test(j.title || ""),
        source: "workable",
        posted_at: toIso(j.published),
        jd_text: null, // list endpoint carries no description
        seniority: inferSeniority(j.title),
      });
    }
    token = data.nextPage;
    page++;
    if (!token) break;
  }
  return all.filter((j) => j.url && isPM(j.title) && isEU(j.location));
}

async function fetchWorkday(b) {
  const sub = b.subdomain || "wd1";
  const url = `https://${b.tenant}.${sub}.myworkdayjobs.com/wday/cxs/${b.tenant}/${b.site}/jobs`;
  const all = [];
  let offset = 0;
  let total = Infinity; // pinned to the FIRST page's count; later pages can wrongly report 0
  let page = 0;
  while (offset < total && page < MAX_PAGES) {
    const res = await fetch(
      url,
      fetchOpts({
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: "product manager" }),
      })
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (page === 0) total = data.total || 0;
    const postings = data.jobPostings || [];
    if (!postings.length) break; // empty page → done (don't trust a flaky total)
    for (const j of postings) {
      const location = j.locationsText || (j.locations && j.locations[0]) || null;
      all.push({
        company: b.company,
        title: j.title || "",
        url: j.externalPath
          ? `https://${b.tenant}.${sub}.myworkdayjobs.com/${b.site}${j.externalPath}`
          : "",
        location,
        remote: /remote/i.test(location || "") || /remote/i.test(j.title || ""),
        source: "workday",
        posted_at: null, // postedOn is relative ("Posted 3 Days Ago"), not a date
        jd_text: null, // list endpoint carries no description
        seniority: inferSeniority(j.title),
      });
    }
    offset += 20;
    page++;
  }
  return all.filter((j) => j.url && isPM(j.title) && isEU(j.location));
}

// Factorial — self-hosted Rails careers (careers.factorialhr.com). SSR homepage
// lists every opening as /job_posting/{slug}-{id}; the markup has no titles/dates,
// so de-slug for a cheap PM pre-filter, then GET the detail page (only for PM
// matches) and grep the schema.org JobPosting fields. All openings on one page —
// no pagination.
const PM_GATE =
  /(product[ -]manager|product[ -]owner|head of product|group product|principal product|product lead|associate product|\bapm\b|growth (manager|lead|product))/i;
const deslug = (s) => s.replace(/-\d+$/, "").replace(/-/g, " ");
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const grab = (h, re) => {
  const m = h.match(re);
  return m ? m[1] : "";
};

async function fetchFactorial(b) {
  const home = await (await fetch("https://careers.factorialhr.com", fetchOpts({ headers: { "User-Agent": UA } }))).text();
  const slugs = [
    ...new Set([...home.matchAll(/\/job_posting\/([a-z0-9][a-z0-9-]+)/g)].map((m) => m[1])),
  ];
  const jobs = [];
  for (const slug of slugs) {
    const human = deslug(slug);
    if (!PM_GATE.test(human)) continue; // cheap pre-filter — skip the detail fetch
    const detailUrl = `https://careers.factorialhr.com/job_posting/${slug}`;
    let title = titleCase(human);
    let location = null;
    let posted = null;
    let jd = null;
    try {
      const d = await (await fetch(detailUrl, fetchOpts({ headers: { "User-Agent": UA } }))).text();
      title = grab(d, /"title":"((?:[^"\\]|\\.){3,90})"/) || title;
      const city = grab(d, /"addressLocality":"([^"]{2,40})"/);
      const country = grab(d, /"addressCountry":"([^"]{2,40})"/);
      location = city ? `${city}${country ? ", " + country : ""}` : null;
      posted = toIso(grab(d, /"datePosted":"([0-9T:\-.Z]{4,30})"/));
      const rawDesc = grab(d, /"description":"((?:[^"\\]|\\.){0,8000})"/);
      jd = rawDesc ? stripHtml(rawDesc.replace(/\\[nrt]/g, " ")).slice(0, 8000) || null : null;
    } catch {
      // detail fetch failed — keep the de-slugged stub (location null → passes isEU)
    }
    jobs.push({
      company: b.company,
      title,
      url: detailUrl,
      location,
      remote: /remote/i.test(location || "") || /remote/i.test(title || ""),
      source: "factorial",
      posted_at: posted,
      jd_text: jd,
      seniority: inferSeniority(title),
    });
  }
  return jobs.filter((j) => isPM(j.title) && isEU(j.location));
}

const FACTORIAL = [{ company: "Factorial" }];

// ── Exported source descriptors (one per board/company) ──────────────────────
export const sources = [
  ...SMARTRECRUITERS.map((b) => ({ company: b.company, run: () => fetchSmartRecruiters(b) })),
  ...WORKABLE.map((b) => ({ company: b.company, run: () => fetchWorkable(b) })),
  ...WORKDAY.map((b) => ({ company: b.company, run: () => fetchWorkday(b) })),
  ...FACTORIAL.map((b) => ({ company: b.company, run: () => fetchFactorial(b) })),
];
