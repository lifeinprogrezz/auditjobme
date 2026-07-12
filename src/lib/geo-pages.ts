// Public GEO surface — build-time prerender of the finite city×vertical page set
// (Track D F2, issue #39). SSG-in-Vite (Decision 1, 2026-07-11): the authed app
// stays a client SPA; this pure lib emits real, server-visible HTML + JSON-LD for
// the discovery surface, written into dist/ by the Vite plugin in vite.config.ts.
//
// Everything here is pure and framework-free (string templating, no React, no DOM,
// no network) so it is unit-tested offline (src/test/geo-pages.test.ts) AND safe to
// import from the Vite config bundle. The data comes from the F3 static dataplane
// artifact (dataplane.json) — ZERO per-page DB reads, one fetch at build time.
//
// GEO doctrine (research bible §5): lead every page with dated, self-citing
// statistics; carry JobPosting + Organization JSON-LD; guard against thin
// "doorway" pages (a page exists only when it has ≥ MIN_ROLES_PER_PAGE live roles).

import { cityOf } from "./geo";
import type { DataplaneJob, DataplaneCompany } from "./dataplane";

export const DEFAULT_ORIGIN = "https://auditjob.me";
/** Doorway-page guard: below this many live roles a (city, vertical) page is thin
 *  boilerplate, so it is NOT generated (never indexed). The single most important
 *  GEO rule — every page must carry unique, verifiable data. */
export const MIN_ROLES_PER_PAGE = 5;
/** Cap the visible role table so a huge city page stays a reasonable size. */
export const MAX_ROLES_LISTED = 100;
/** Cap JobPosting entries in the JSON-LD ItemList (schema payload size). */
export const MAX_JOBPOSTINGS = 50;
/** How many nearby sibling pages (same vertical, other cities) to cross-link. */
export const MAX_SIBLINGS = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const SITE_NAME = "auditjob.me";
const SITE_TAGLINE =
  "The live map of tech jobs in Europe. Every opening scraped daily from the companies' own career pages and scored against your CV. Free.";

export interface SiteInput {
  jobs: DataplaneJob[];
  companies: DataplaneCompany[];
  generated_at?: string | null;
}

export interface RenderOptions {
  origin?: string;
  /** "now" reference for the "posted this week" stat — passed in tests for determinism. */
  now?: number;
  minRoles?: number;
}

export interface GeoPage {
  city: string;
  citySlug: string;
  verticalSlug: string;
  verticalLabel: string;
  /** URL path, e.g. "/jobs/berlin/product/". */
  path: string;
  /** Output file, e.g. "jobs/berlin/product/index.html". */
  file: string;
  /** Full group, sorted freshest-first. */
  jobs: DataplaneJob[];
  companyCount: number;
  postedLast7: number;
  latestPostedAt: string | null;
  topEmployers: { company: string; count: number }[];
  salary: { currency: string; median: number; n: number } | null;
}

export interface RenderedFile {
  /** Path relative to the build output root (no leading slash). */
  path: string;
  content: string;
}

// ── pure helpers ────────────────────────────────────────────────────────────

/** URL-safe slug: fold diacritics, non-alphanumerics → single hyphens. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const VERTICAL_LABELS: Record<string, string> = {
  product: "Product Manager",
};

/** Role vertical → { slug, label }. Null role_family = the pre-all-vertical row
 *  (the pipeline is PM-gated, issue #34) → the Product Manager vertical, matching
 *  roles.ts roleFamily(). Real values win the moment the engine writes them. */
export function verticalOf(job: Pick<DataplaneJob, "role_family">): {
  slug: string;
  label: string;
} {
  const rf = job.role_family?.trim();
  if (!rf) return { slug: "product", label: "Product Manager" };
  const slug = slugify(rf) || "product";
  return { slug, label: VERTICAL_LABELS[slug] ?? titleCase(rf) };
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Human labels for the normalized seniority ladder, mirroring roles.ts LEVELS so
// the fact pages speak the same vocabulary as the app (apm→Junior, pm→Mid, …).
const SENIORITY_LABELS: Record<string, string> = {
  apm: "Junior",
  pm: "Mid",
  senior: "Senior",
  lead: "Lead",
  founding: "Executive",
};
function seniorityLabel(seniority: string | null | undefined): string {
  const s = seniority?.trim().toLowerCase();
  if (!s) return "";
  return SENIORITY_LABELS[s] ?? titleCase(s);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline a JSON-LD object as a <script> block, escaping "<" so a value can never
 *  break out of the script element. */
export function jsonLdScript(obj: unknown): string {
  const json = JSON.stringify(obj).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

function postedMs(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Freshest posted_at wins the sort; unknown dates sink; ties break by id for a
 *  byte-stable build. */
function byFreshest(a: DataplaneJob, b: DataplaneJob): number {
  const ta = postedMs(a.posted_at) ?? -Infinity;
  const tb = postedMs(b.posted_at) ?? -Infinity;
  if (ta !== tb) return tb - ta;
  return String(a.id).localeCompare(String(b.id));
}

/** Median annual base for the group, but only when the signal is real: ≥5 roles
 *  carry a numeric annual salary_min in ONE dominant currency. Otherwise null —
 *  we never invent or mix currencies. (Extraction is sparse today; this lights up
 *  as the JD-extraction pass fills jobs.extraction.) */
function salaryStat(
  jobs: DataplaneJob[],
): { currency: string; median: number; n: number } | null {
  const byCurrency = new Map<string, number[]>();
  for (const j of jobs) {
    const ex = j.extraction as
      | { salary_min?: number | null; salary_period?: string | null; salary_currency?: string | null }
      | null
      | undefined;
    if (!ex) continue;
    const min = ex.salary_min;
    const cur = ex.salary_currency?.trim();
    const period = (ex.salary_period ?? "year").trim().toLowerCase();
    if (typeof min !== "number" || !Number.isFinite(min) || min <= 0) continue;
    if (!cur) continue;
    if (period !== "year" && period !== "annual" && period !== "yearly") continue;
    const arr = byCurrency.get(cur) ?? [];
    arr.push(min);
    byCurrency.set(cur, arr);
  }
  let best: { currency: string; values: number[] } | null = null;
  for (const [currency, values] of byCurrency) {
    if (!best || values.length > best.values.length) best = { currency, values };
  }
  if (!best || best.values.length < 5) return null;
  const sorted = [...best.values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return { currency: best.currency, median, n: best.values.length };
}

function fmtMoney(currency: string, n: number): string {
  const symbol = currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency === "USD" ? "$" : "";
  const grouped = n.toLocaleString("en-US");
  return symbol ? `${symbol}${grouped}` : `${grouped} ${currency}`;
}

// ── page set ─────────────────────────────────────────────────────────────────

/** Build the finite city×vertical page set from the dataplane rows. Deterministic:
 *  groups and their contents are stably sorted so two builds over the same artifact
 *  are byte-identical. Groups below the doorway threshold are dropped. */
export function buildPages(input: SiteInput, opts: RenderOptions = {}): GeoPage[] {
  const now = opts.now ?? Date.now();
  const minRoles = opts.minRoles ?? MIN_ROLES_PER_PAGE;

  const groups = new Map<string, { city: string; vertical: { slug: string; label: string }; jobs: DataplaneJob[] }>();
  for (const job of input.jobs) {
    const city = cityOf(job.location);
    if (!city) continue; // remote-only / unknown location → no city page
    const vertical = verticalOf(job);
    const key = `${city} ${vertical.slug}`;
    const g = groups.get(key) ?? { city, vertical, jobs: [] };
    g.jobs.push(job);
    groups.set(key, g);
  }

  const pages: GeoPage[] = [];
  for (const g of groups.values()) {
    if (g.jobs.length < minRoles) continue;
    const jobs = [...g.jobs].sort(byFreshest);
    const citySlug = slugify(g.city);
    const companies = new Set(jobs.map((j) => j.company.trim().toLowerCase()));
    const postedLast7 = jobs.filter((j) => {
      const t = postedMs(j.posted_at);
      return t != null && t <= now && now - t <= WEEK_MS;
    }).length;
    const datedIso = jobs.map((j) => j.posted_at).filter((d): d is string => !!postedMs(d)).sort();
    const latestPostedAt = datedIso.length ? datedIso[datedIso.length - 1] : null;
    // Top employers by role count (ties → alphabetical, stable).
    const counts = new Map<string, number>();
    for (const j of jobs) counts.set(j.company, (counts.get(j.company) ?? 0) + 1);
    const topEmployers = [...counts.entries()]
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count || a.company.localeCompare(b.company))
      .slice(0, 8);

    pages.push({
      city: g.city,
      citySlug,
      verticalSlug: g.vertical.slug,
      verticalLabel: g.vertical.label,
      path: `/jobs/${citySlug}/${g.vertical.slug}/`,
      file: `jobs/${citySlug}/${g.vertical.slug}/index.html`,
      jobs,
      companyCount: companies.size,
      postedLast7,
      latestPostedAt,
      topEmployers,
      salary: salaryStat(jobs),
    });
  }
  // Stable order: city then vertical.
  pages.sort((a, b) => a.citySlug.localeCompare(b.citySlug) || a.verticalSlug.localeCompare(b.verticalSlug));
  return pages;
}

// ── copy ─────────────────────────────────────────────────────────────────────

function isoDate(iso: string | null | undefined, fallback: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  const d = Number.isNaN(t) ? new Date(fallback) : new Date(t);
  return d.toISOString().slice(0, 10);
}

/** Human date like "12 July 2026" for the self-citing lead sentence. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${d} ${months[m - 1]} ${y}`;
}

/** The quotable, self-citing GEO lead sentence — dated, sourced, numbers-only-when-real. */
export function leadSentence(page: GeoPage, dateIso: string): string {
  const roleWord = page.jobs.length === 1 ? "role" : "roles";
  const coWord = page.companyCount === 1 ? "company" : "companies";
  let s = `As of ${longDate(dateIso)} there are ${page.jobs.length} ${page.verticalLabel} ${roleWord} in ${page.city} across ${page.companyCount} ${coWord} on ${SITE_NAME}.`;
  if (page.postedLast7 > 0) {
    s += ` ${page.postedLast7} ${page.postedLast7 === 1 ? "was" : "were"} posted in the last 7 days.`;
  }
  if (page.salary) {
    s += ` The median advertised base is ${fmtMoney(page.salary.currency, page.salary.median)}.`;
  }
  return s;
}

// ── JSON-LD ──────────────────────────────────────────────────────────────────

function organizationLd(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: `${origin}/`,
    description: SITE_TAGLINE,
    logo: `${origin}/og.jpg`,
  };
}

function breadcrumbLd(page: GeoPage, origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: "Jobs", item: `${origin}/jobs/` },
      {
        "@type": "ListItem",
        position: 3,
        name: `${page.verticalLabel} jobs in ${page.city}`,
        item: `${origin}${page.path}`,
      },
    ],
  };
}

function jobPostingLd(
  job: DataplaneJob,
  page: GeoPage,
  companiesBySlug: Map<string, DataplaneCompany>,
): Record<string, unknown> {
  const co = job.company_id ? companiesBySlug.get(job.company_id) : undefined;
  const level = seniorityLabel(job.seniority);
  const seniority = level ? `${level} level. ` : "";
  const remote = job.remote ? "Remote-friendly. " : "";
  const description =
    `${job.title} at ${job.company}${page.city ? ` in ${page.city}` : ""}. ` +
    `${seniority}${remote}A ${page.verticalLabel} opening scraped from the company's own careers page. ` +
    `Apply directly via ${SITE_NAME}.`;
  const org: Record<string, unknown> = { "@type": "Organization", name: job.company };
  if (co?.website) org.sameAs = co.website;
  if (co?.logo_domain) org.logo = `https://${co.logo_domain}`;

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description,
    datePosted: job.posted_at,
    hiringOrganization: org,
    jobLocation: {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: page.city },
    },
    url: job.url,
    identifier: { "@type": "PropertyValue", name: SITE_NAME, value: job.id },
  };
  if (job.remote) ld.jobLocationType = "TELECOMMUTE";

  const ex = job.extraction as
    | { salary_min?: number | null; salary_max?: number | null; salary_currency?: string | null; salary_period?: string | null }
    | null
    | undefined;
  if (ex && typeof ex.salary_min === "number" && ex.salary_currency) {
    ld.baseSalary = {
      "@type": "MonetaryAmount",
      currency: ex.salary_currency,
      value: {
        "@type": "QuantitativeValue",
        minValue: ex.salary_min,
        ...(typeof ex.salary_max === "number" ? { maxValue: ex.salary_max } : {}),
        unitText: (ex.salary_period ?? "YEAR").toUpperCase(),
      },
    };
  }
  return ld;
}

/** ItemList wrapping the group's JobPostings. Only roles with a datePosted are
 *  included (JobPosting.datePosted is required) and the list is capped. */
function itemListLd(
  page: GeoPage,
  companiesBySlug: Map<string, DataplaneCompany>,
) {
  const withDate = page.jobs.filter((j) => !!postedMs(j.posted_at)).slice(0, MAX_JOBPOSTINGS);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${page.verticalLabel} jobs in ${page.city}`,
    numberOfItems: withDate.length,
    itemListElement: withDate.map((job, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: jobPostingLd(job, page, companiesBySlug),
    })),
  };
}

// ── HTML ─────────────────────────────────────────────────────────────────────

// Monochrome ink-glass tokens lifted verbatim from src/index.css / BRAND.md — the
// same palette as the live product. These are lightweight, request-free content
// pages (no app bundle, no web fonts), so tokens are inlined and fonts fall back
// to the system stack; color stays 100% on-brand.
const PAGE_CSS = `
:root{--bg:#f7f9fa;--surface:#ffffff;--surface2:#f0f4f6;--ink:#0b1f26;--muted:#3f5a63;--subtle:#6f8a92;--border:rgba(11,31,38,.12);--accent:#12a594}
@media (prefers-color-scheme:dark){:root{--bg:#0a141a;--surface:#0f1d24;--surface2:#16262e;--ink:#eaf2f3;--muted:#9db1b8;--subtle:#6e858e;--border:rgba(255,255,255,.12);--accent:#1fd8b8}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Geist Sans","Space Grotesk",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.55;letter-spacing:-.006em}
a{color:inherit}
.wrap{max-width:880px;margin:0 auto;padding:28px 20px 64px}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:20px;border-bottom:1px solid var(--border)}
.brand{font-weight:600;text-decoration:none;letter-spacing:-.02em}
.brand span{color:var(--accent)}
nav a{color:var(--muted);text-decoration:none;font-size:14px;margin-left:16px}
nav a:hover{color:var(--ink)}
h1{font-size:clamp(1.6rem,4vw,2.2rem);letter-spacing:-.02em;margin:28px 0 8px}
.lead{font-size:1.05rem;color:var(--ink);margin:0 0 4px}
.source{color:var(--subtle);font-size:13px;margin:6px 0 24px}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 28px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 16px;min-width:110px}
.stat b{display:block;font-size:1.35rem;letter-spacing:-.02em}
.stat span{color:var(--subtle);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
h2{font-size:1.15rem;letter-spacing:-.01em;margin:32px 0 12px}
.tablewrap{overflow-x:auto;border:1px solid var(--border);border-radius:14px;background:var(--surface)}
table{width:100%;border-collapse:collapse;font-size:14px;min-width:520px}
th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--border);vertical-align:top}
th{color:var(--subtle);font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
tr:last-child td{border-bottom:0}
td a{color:var(--ink);text-decoration:none;font-weight:500}
td a:hover{text-decoration:underline}
.co{color:var(--muted)}
.when{color:var(--subtle);white-space:nowrap}
.chips{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:0}
.chips a,.chips li{background:var(--surface2);border:1px solid var(--border);border-radius:999px;padding:6px 12px;font-size:13px;text-decoration:none;color:var(--muted)}
.chips a:hover{color:var(--ink)}
.cta{display:inline-block;margin-top:8px;background:var(--ink);color:var(--bg);border-radius:11px;padding:10px 18px;text-decoration:none;font-weight:500}
footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--border);color:var(--subtle);font-size:13px}
footer a{color:var(--muted)}
`.trim();

function pageHead(opts: {
  title: string;
  description: string;
  canonical: string;
  origin: string;
  jsonLd: string[];
}): string {
  const { title, description, canonical, origin, jsonLd } = opts;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta name="robots" content="index,follow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${origin}/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${origin}/og.jpg">
<style>${PAGE_CSS}</style>
${jsonLd.join("\n")}
</head>`;
}

function siteHeader(origin: string): string {
  return `<header>
<a class="brand" href="${origin}/">audit<span>job</span>.me</a>
<nav><a href="${origin}/">Live map</a><a href="${origin}/jobs/">All cities</a></nav>
</header>`;
}

function roleRow(job: DataplaneJob, dateIso: string): string {
  const when = job.posted_at ? relDays(job.posted_at, Date.parse(dateIso + "T00:00:00Z")) : "";
  const level = escapeHtml(seniorityLabel(job.seniority));
  return `<tr><td><a href="${escapeHtml(job.url)}" rel="nofollow">${escapeHtml(job.title)}</a><div class="co">${escapeHtml(job.company)}</div></td><td>${level}</td><td class="when">${escapeHtml(when)}</td></tr>`;
}

function relDays(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t > now) return "";
  const days = Math.floor((now - t) / 86_400_000);
  if (days === 0) return "today";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

/** Render one city×vertical page. `siblings` = other pages of the SAME vertical for
 *  cross-linking (hub-and-spoke, click depth ≤3). */
export function renderPage(
  page: GeoPage,
  siblings: GeoPage[],
  companiesBySlug: Map<string, DataplaneCompany>,
  ctx: { origin: string; generatedAt: string },
): string {
  const { origin } = ctx;
  // "As of" = the dataplane snapshot date (when this live count was true), not the
  // freshest posting; sitemap lastmod carries the freshness signal separately.
  const dateIso = isoDate(ctx.generatedAt, Date.parse(ctx.generatedAt));
  const title = `${page.verticalLabel} jobs in ${page.city} (${page.jobs.length} live) · ${SITE_NAME}`;
  const description = leadSentence(page, dateIso);
  const canonical = `${origin}${page.path}`;

  const jsonLd = [
    jsonLdScript(organizationLd(origin)),
    jsonLdScript(breadcrumbLd(page, origin)),
    jsonLdScript(itemListLd(page, companiesBySlug)),
  ];

  const shown = page.jobs.slice(0, MAX_ROLES_LISTED);
  const more =
    page.jobs.length > shown.length
      ? `<p class="source">Showing the ${shown.length} freshest of ${page.jobs.length} live roles. See them all on the <a href="${origin}/">live map</a>.</p>`
      : "";

  const employers = page.topEmployers.length
    ? `<h2>Who's hiring</h2><ul class="chips">${page.topEmployers
        .map((e) => `<li>${escapeHtml(e.company)} · ${e.count}</li>`)
        .join("")}</ul>`
    : "";

  const near = siblings
    .filter((s) => s.path !== page.path)
    .slice(0, MAX_SIBLINGS);
  const nearby = near.length
    ? `<h2>${escapeHtml(page.verticalLabel)} jobs in other cities</h2><div class="chips">${near
        .map((s) => `<a href="${origin}${s.path}">${escapeHtml(s.city)} · ${s.jobs.length}</a>`)
        .join("")}</div>`
    : "";

  return `${pageHead({ title, description, canonical, origin, jsonLd })}
<body>
<div class="wrap">
${siteHeader(origin)}
<h1>${escapeHtml(page.verticalLabel)} jobs in ${escapeHtml(page.city)}</h1>
<p class="lead">${escapeHtml(description)}</p>
<p class="source">Data from ${SITE_NAME}'s daily scrape of company career pages. Last updated ${escapeHtml(longDate(dateIso))}.</p>
<div class="stats">
<div class="stat"><b>${page.jobs.length}</b><span>Live roles</span></div>
<div class="stat"><b>${page.companyCount}</b><span>Companies</span></div>
<div class="stat"><b>${page.postedLast7}</b><span>New this week</span></div>${
    page.salary
      ? `\n<div class="stat"><b>${escapeHtml(fmtMoney(page.salary.currency, page.salary.median))}</b><span>Median base</span></div>`
      : ""
  }
</div>
<a class="cta" href="${origin}/">Score these against your CV</a>
<h2>Open roles</h2>
<div class="tablewrap"><table>
<thead><tr><th>Role</th><th>Level</th><th>Posted</th></tr></thead>
<tbody>${shown.map((j) => roleRow(j, dateIso)).join("")}</tbody>
</table></div>
${more}
${employers}
${nearby}
<footer>
<a href="${origin}/jobs/">All ${SITE_NAME} job pages</a> · <a href="${origin}/">Live map</a><br>
${SITE_NAME} scrapes ${SITE_TAGLINE.toLowerCase().replace(/\.$/, "")}.
</footer>
</div>
</body>
</html>`;
}

/** The /jobs/ hub: every generated page, grouped for browse + crawl reachability. */
export function renderIndex(pages: GeoPage[], ctx: { origin: string; generatedAt: string }): string {
  const { origin } = ctx;
  const title = `Tech jobs across Europe, city by city · ${SITE_NAME}`;
  const totalRoles = pages.reduce((n, p) => n + p.jobs.length, 0);
  const description = `${totalRoles} live tech roles across ${pages.length} city pages, scraped daily from company career pages and scored against your CV on ${SITE_NAME}.`;
  const canonical = `${origin}/jobs/`;
  const rows = pages
    .map(
      (p) =>
        `<li><a href="${origin}${p.path}">${escapeHtml(p.verticalLabel)} jobs in ${escapeHtml(p.city)}</a> · ${p.jobs.length} live · ${p.companyCount} companies</li>`,
    )
    .join("");
  return `${pageHead({
    title,
    description,
    canonical,
    origin,
    jsonLd: [jsonLdScript(organizationLd(origin))],
  })}
<body>
<div class="wrap">
${siteHeader(origin)}
<h1>Tech jobs across Europe</h1>
<p class="lead">${escapeHtml(description)}</p>
<p class="source">Data from ${SITE_NAME}'s daily scrape of company career pages.</p>
<a class="cta" href="${origin}/">Open the live map</a>
<h2>City pages</h2>
<ul class="chips" style="flex-direction:column;align-items:stretch">${rows}</ul>
<footer><a href="${origin}/">Live map</a> · ${escapeHtml(SITE_TAGLINE)}</footer>
</div>
</body>
</html>`;
}

// ── sitemap + llms.txt ────────────────────────────────────────────────────────

export function renderSitemap(pages: GeoPage[], ctx: { origin: string; generatedAt: string }): string {
  const { origin } = ctx;
  const today = isoDate(ctx.generatedAt, Date.parse(ctx.generatedAt));
  const urls = [
    { loc: `${origin}/`, lastmod: today, changefreq: "daily" },
    // The /jobs/ hub only exists when at least one city page qualifies.
    ...(pages.length ? [{ loc: `${origin}/jobs/`, lastmod: today, changefreq: "daily" }] : []),
    ...pages.map((p) => ({
      loc: `${origin}${p.path}`,
      lastmod: isoDate(p.latestPostedAt ?? ctx.generatedAt, Date.parse(ctx.generatedAt)),
      changefreq: "daily",
    })),
  ];
  const body = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** Root llms.txt — an agent-discovery index (research bible §5: cheap insurance,
 *  NOT a proven citation driver). Dated, self-citing, links every city page. */
export function renderLlmsTxt(pages: GeoPage[], ctx: { origin: string; generatedAt: string }): string {
  const { origin } = ctx;
  const today = isoDate(ctx.generatedAt, Date.parse(ctx.generatedAt));
  const totalRoles = pages.reduce((n, p) => n + p.jobs.length, 0);
  const lines: string[] = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_TAGLINE}`,
    "",
    `Last updated ${today}. ${totalRoles} live roles across ${pages.length} city pages. Data is scraped daily from companies' own career pages; every count on a page is live and dated.`,
    "",
    "## Job pages",
    ...pages.map(
      (p) =>
        `- [${p.verticalLabel} jobs in ${p.city}](${origin}${p.path}): ${p.jobs.length} live roles across ${p.companyCount} companies${p.postedLast7 ? `, ${p.postedLast7} new this week` : ""}.`,
    ),
    "",
    "## About",
    `- [Live job map](${origin}/): interactive map of every scraped role, scored against your CV.`,
    `- [All city pages](${origin}/jobs/): the full index of city pages.`,
    "",
  ];
  return lines.join("\n");
}

// ── the single entry the Vite plugin calls ────────────────────────────────────

/** Turn the dataplane artifact into the full set of static files for dist/:
 *  the /jobs/ hub, every city×vertical page, sitemap.xml and llms.txt. Pure and
 *  deterministic given the same input + options. */
export function renderSite(input: SiteInput, opts: RenderOptions = {}): RenderedFile[] {
  const origin = (opts.origin ?? DEFAULT_ORIGIN).replace(/\/$/, "");
  // generated_at is trusted only when it is a parseable timestamp. A malformed
  // artifact can carry any string ("not-a-date"), and an unparseable one would
  // crash isoDate()'s `new Date(NaN).toISOString()` and brick the whole build —
  // so fall back to now (opts.now in tests) instead.
  const genRaw = input.generated_at;
  const generatedAt =
    genRaw && !Number.isNaN(Date.parse(genRaw))
      ? genRaw
      : new Date(opts.now ?? Date.now()).toISOString();
  const ctx = { origin, generatedAt };

  const pages = buildPages(input, opts);
  const companiesBySlug = new Map<string, DataplaneCompany>();
  for (const c of input.companies) companiesBySlug.set(c.slug, c);

  const files: RenderedFile[] = [];
  // Same-vertical siblings for cross-linking.
  for (const page of pages) {
    const siblings = pages.filter((p) => p.verticalSlug === page.verticalSlug && p.path !== page.path);
    files.push({ path: page.file, content: renderPage(page, siblings, companiesBySlug, ctx) });
  }
  if (pages.length) {
    files.push({ path: "jobs/index.html", content: renderIndex(pages, ctx) });
  }
  files.push({ path: "sitemap.xml", content: renderSitemap(pages, ctx) });
  files.push({ path: "llms.txt", content: renderLlmsTxt(pages, ctx) });
  return files;
}
