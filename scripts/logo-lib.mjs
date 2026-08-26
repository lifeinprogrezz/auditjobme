/**
 * Logo-domain derivation for the companies dimension (issue #68 item 4).
 * `companies.logo_domain` feeds src/lib/logodev.ts — a WRONG domain renders a
 * WRONG company logo, so this only derives a domain from URLs the company
 * itself owns (careers_url, website) and returns null rather than guessing.
 *
 * Pure logic, no network. Pinned by src/test/logo-lib.test.ts.
 */

// Hosted-ATS / platform hosts: a careers URL on one of these is NOT the
// company's own domain (careers.macadam.app IS; macadam.teamtailor.com is not).
const GENERIC_HOST_SUFFIXES = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "smartrecruiters.com",
  "teamtailor.com",
  "myworkdayjobs.com",
  "workday.com",
  "factorialhr.com",
  "factorialhr.es",
  "breezy.hr",
  "bamboohr.com",
  "recruitee.com",
  "join.com",
  "personio.de",
  "personio.com",
  "jobvite.com",
  "icims.com",
  "linkedin.com",
  "getro.com",
  "startupmap.one",
  "notion.site",
  "notion.so",
  "webflow.io",
  "vercel.app",
  "netlify.app",
  // Job-board / aggregator hosts an apply URL (item B1 fallback) can point
  // at instead of the company's own site (issue #153 fix round 1: measured
  // live on prod, these produced 43+ wrong logo_domain/website guesses --
  // welcometothejungle.com alone on 19 companies, ycombinator.com on 10).
  "welcometothejungle.com",
  "ycombinator.com",
  "workatastartup.com",
  "gem.com",
  "dover.com",
  "wellfound.com",
  "thehub.io",
  "employmenthero.com",
  "screenloop.com",
  "rippling.com",
  "hibob.com",
  "comeet.com",
  "myworkdaysite.com",
];

// A leading label that marks a careers SUBDOMAIN of the real domain
// (careers.macadam.app -> macadam.app). Only ever strips ONE label.
const STRIPPABLE_LABELS = new Set(["www", "careers", "jobs", "apply", "hire", "join", "work", "talent", "team", "boards"]);

function isGenericHost(host) {
  return GENERIC_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

/** Derive a company logo domain from ONE url; null when not derivable. */
export function domainFromUrl(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(String(url).includes("://") ? url : `https://${url}`);
  } catch {
    return null;
  }
  let host = u.hostname.toLowerCase();
  if (!host.includes(".") || isGenericHost(host)) return null;
  const labels = host.split(".");
  if (labels.length > 2 && STRIPPABLE_LABELS.has(labels[0])) {
    host = labels.slice(1).join(".");
  }
  return host;
}

/**
 * Derive a logo domain for a company row: the careers URL wins (it is the
 * surface the row was discovered on), the website is the fallback.
 */
export function deriveLogoDomain({ careersUrl, website } = {}) {
  return domainFromUrl(careersUrl) || domainFromUrl(website) || null;
}

/**
 * Full fallback order for a company with no logo domain yet (issue #153 item
 * B1): careers_url/website first (deriveLogoDomain, unchanged), then — ONLY
 * for a company with NEITHER on file at all, e.g. a job-derived row created by
 * scripts/company-records.mjs with nothing but a name — the first of its own
 * live-job apply URLs whose host is not a hosted-ATS/platform host.
 * domainFromUrl() already excludes every such host, so a resolved fallback
 * domain is the company's own site, never a wrong-company guess. When it
 * resolves, the SAME domain doubles as the company's website (nothing else
 * has ever named one), returned separately so a caller can persist both
 * columns without touching an existing website that just didn't resolve.
 */
export function resolveLogoDomain({ careersUrl, website, applyUrls } = {}) {
  const direct = deriveLogoDomain({ careersUrl, website });
  if (direct) return { domain: direct, derivedWebsite: null };
  if (website) return { domain: null, derivedWebsite: null }; // has a website; it just didn't resolve — don't guess elsewhere
  for (const url of applyUrls || []) {
    const domain = domainFromUrl(url);
    if (domain) return { domain, derivedWebsite: `https://${domain}` };
  }
  return { domain: null, derivedWebsite: null };
}

/**
 * Data-driven aggregator guard (issue #153 fix round 1, blocker 1). Even with
 * GENERIC_HOST_SUFFIXES covering every known aggregator/ATS host, a NEW one
 * can still slip through the apply-URL fallback (item B1) -- on prod,
 * welcometothejungle.com resolved as 19 different companies' "own" domain,
 * ycombinator.com 10, before those hosts were added to the list above. The
 * tell: a real company's own domain is used by exactly ONE company; an
 * aggregator's is shared by many. Any derived domain shared by >= minCompanies
 * distinct companies IN ONE RUN is treated as an aggregator signature and
 * excluded -- never written as anyone's logo_domain/website.
 */
export function partitionAggregatorDomains(fills, minCompanies = 3) {
  const counts = new Map();
  for (const f of fills) counts.set(f.domain, (counts.get(f.domain) ?? 0) + 1);
  const aggregatorDomains = new Set([...counts].filter(([, n]) => n >= minCompanies).map(([d]) => d));
  const safe = fills.filter((f) => !aggregatorDomains.has(f.domain));
  const skipped = fills.filter((f) => aggregatorDomains.has(f.domain));
  return { safe, skipped, aggregatorDomains };
}
