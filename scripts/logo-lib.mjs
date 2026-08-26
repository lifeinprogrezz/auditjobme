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
  // Issue #153 fix round 2, blocker 3: projected over the 852 unlinked
  // companies (297 derivable), these ATS/HR-platform hosts leaked into
  // logo_domain/website the same way the round-1 list did -- emp.jobylon.com
  // (Furhat), revolutpeople.com (Terra API), taleez.com (Enchanted Tools),
  // builtin.com (FindMeCure), *.welcomekit.co (Wandercraft/Corma/Flynt),
  // *.haileyhr.app, *.keka.com, *.viterbit.site, *.odoo.com.
  "jobylon.com",
  "revolutpeople.com",
  "taleez.com",
  "builtin.com",
  "welcomekit.co",
  "haileyhr.app",
  "keka.com",
  "viterbit.site",
  "odoo.com",
];

// A leading label that marks a careers SUBDOMAIN of the real domain
// (careers.macadam.app -> macadam.app). Only ever strips ONE label.
const STRIPPABLE_LABELS = new Set([
  "www",
  "careers",
  "career", // singular -- issue #153 fix round 2, blocker 3: career.mynt.com and
  // 16 others (flinn, anyfin, oneflow, stegra, na-kd, ...) kept the careers
  // page as companies.website because only the plural was stripped.
  "jobs",
  "apply",
  "hire",
  "join",
  "work",
  "talent",
  "talento", // Spanish "talent" -- same class of leak on Spanish-market careers pages.
  "empleo", // Spanish "jobs".
  "about",
  "corporate",
  "team",
  "boards",
]);

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

// Second-level ccTLDs where the real registrable base is the last THREE
// labels, not two -- otherwise registrableDomain() below would merge every
// company on e.g. a .co.uk domain into one false aggregator bucket. Not a
// full public-suffix list, just the handful actually seen among company
// domains here (domainFromUrl already keeps acme.co.uk as a real domain).
const SECOND_LEVEL_CCTLDS = new Set(["co.uk", "org.uk", "ac.uk", "co.jp", "co.nz", "com.au", "com.br"]);

/** The base a shared-host count should group by -- issue #153 fix round 2,
 *  blocker 3: three welcomekit.co companies (Wandercraft/Corma/Flynt) each
 *  resolved to a DIFFERENT full host (wandercraft.welcomekit.co vs
 *  corma.welcomekit.co vs flynt.welcomekit.co), so the exact-host count
 *  below never saw 3 of the same string and the >=N guard never fired. Last
 *  two labels, except a known second-level ccTLD where it's the last three. */
function registrableDomain(host) {
  const labels = String(host || "").split(".");
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  return SECOND_LEVEL_CCTLDS.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

/**
 * Data-driven aggregator guard (issue #153 fix round 1, blocker 1). Even with
 * GENERIC_HOST_SUFFIXES covering every known aggregator/ATS host, a NEW one
 * can still slip through the apply-URL fallback (item B1) -- on prod,
 * welcometothejungle.com resolved as 19 different companies' "own" domain,
 * ycombinator.com 10, before those hosts were added to the list above. The
 * tell: a real company's own domain is used by exactly ONE company; an
 * aggregator's is shared by many -- counted by registrableDomain, so a
 * multi-tenant host that hands each company its OWN subdomain (welcomekit.co
 * above) still gets caught, not just one that reuses one exact host. Any
 * base domain shared by >= minCompanies distinct companies IN ONE RUN is
 * treated as an aggregator signature and excluded -- never written as
 * anyone's logo_domain/website.
 */
export function partitionAggregatorDomains(fills, minCompanies = 3) {
  const counts = new Map();
  for (const f of fills) {
    const base = registrableDomain(f.domain);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const aggregatorDomains = new Set([...counts].filter(([, n]) => n >= minCompanies).map(([d]) => d));
  const safe = fills.filter((f) => !aggregatorDomains.has(registrableDomain(f.domain)));
  const skipped = fills.filter((f) => aggregatorDomains.has(registrableDomain(f.domain)));
  return { safe, skipped, aggregatorDomains };
}
