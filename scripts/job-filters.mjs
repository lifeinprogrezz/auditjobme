/**
 * Pure job-filtering helpers shared by the scraper (scripts/scrape.mjs), its source
 * modules (scripts/sources/*.mjs), the role_family backfill
 * (scripts/backfill-role-family.mjs), and the unit tests
 * (src/test/job-filters.test.ts). Kept as plain ESM (no deps) so all can import it.
 * These decide what lands in the shared `jobs` pool AND which `role_family` each
 * row carries — change them only with a test update.
 *
 * ALL-VERTICAL ENGINE (issue #34; vertical set decided 2026-07-26, planning repo
 * docs/specs/2026-07-26-vertical-set-decision.md). Five families ship:
 *   product · engineering · sales · marketing · operations
 * Design and Data/AI (analyst / scientist seats) are DEFERRED — design because a
 * CV-vs-JD rubric is portfolio-blind, Data/AI because it is too small to earn a
 * fit block this round. Boundary rule from the same decision: Data Engineer,
 * Machine Learning Engineer and Analytics Engineer classify as `engineering`
 * (engineering-shaped, JD-scoreable); "Data/AI deferred" means analyst and
 * scientist roles.
 *
 * The old GLOBAL `NEG_RE` (which killed every `engineer(ing)` title at ingest to
 * keep engineering out of a PM-only product) is now FAMILY-SCOPED: it stays
 * active for `product` (PRODUCT_NEG_RE + DEFERRED_RE reproduce its exact reach)
 * and dies for `engineering` — shipping widened queries without this yields an
 * empty engineering catalog (trap #1 in the decision).
 */

/** The five `jobs.role_family` values shipping in #34, in classifier precedence
 *  order (product first so "Growth Product Manager" is a product seat, sales
 *  before operations so "Revenue Operations" is a sales seat, sales before
 *  engineering so "Solutions Engineer" is a sales seat). */
export const ROLE_FAMILIES = ["product", "sales", "marketing", "operations", "engineering"];

/**
 * Per-family source-module query terms — the decided starting sets (2026-07-26),
 * a first cut to be widened against live yield. Boards that fetch their full
 * catalog and filter locally (Greenhouse/Lever/Ashby/Workable/SmartRecruiters/
 * Teamtailor/Scaling Europe/startupmap/Factorial) don't consume these; paginated
 * search APIs use FAMILY_SEED_QUERIES below.
 */
export const FAMILY_QUERIES = {
  product: [
    "product manager", "product owner", "associate product manager",
    "technical product manager", "group product manager", "product lead",
    "principal product manager", "director of product",
  ],
  engineering: [
    "software engineer", "backend engineer", "frontend engineer",
    "full stack engineer", "platform engineer", "infrastructure engineer",
    "site reliability engineer", "devops engineer", "mobile engineer",
    "iOS engineer", "Android engineer", "data engineer",
    "machine learning engineer", "security engineer", "engineering manager",
    "staff engineer", "tech lead",
  ],
  sales: [
    "account executive", "sales development representative",
    "business development representative", "sales manager", "account manager",
    "partnerships manager", "business development manager", "enterprise sales",
    "solutions engineer", "revenue operations",
  ],
  marketing: [
    "growth manager", "marketing manager", "product marketing manager",
    "demand generation", "performance marketing", "content marketing",
    "brand manager", "lifecycle marketing", "SEO manager",
    "communications manager",
  ],
  operations: [
    "operations manager", "business operations", "chief of staff",
    "finance manager", "financial controller", "people operations",
    "talent acquisition", "recruiter", "human resources manager",
    "office manager", "strategy and operations",
  ],
};

/**
 * ONE representative query per family, for paginated relevance-search APIs
 * (big-tech careers, Getro, Workday) where running every term would multiply
 * request volume ~10×. Those engines match fuzzily — "software engineer"
 * surfaces the whole engineering cluster — and classifyRoleFamily() does the
 * precision work on the results. Full-term recall widening is the decision
 * doc's own next step ("to be widened against live yield").
 */
export const FAMILY_SEED_QUERIES = ROLE_FAMILIES.map((f) => FAMILY_QUERIES[f][0]);

// A Product role title (incl. Product Owner / Head of Product / Founding Product), but NOT
// design / engineering / data / analyst / marketing seats that merely contain "product".
export const PM_RE =
  /\b(product manager|product owner|head of product|group product|principal product|lead product|founding product|director of product|vp,? product|product lead)\b/i;

/** Deferred-vertical seats (Design + Data/AI analyst/scientist) — excluded from
 *  EVERY family. Deliberately does NOT match "analytics engineer" / "data
 *  engineer" / "machine learning engineer" (the boundary rule sends those to
 *  `engineering`). */
export const DEFERRED_RE =
  /designer|product design|design (lead|manager|director)|\bux\b|data scien|\bscientist\b|\banalyst\b/i;

/** Family-scoped negative for `product` only. Together with DEFERRED_RE this
 *  reproduces the old global NEG_RE exactly for the product family, so the
 *  PM catalog neither widens nor narrows in the all-vertical flip. */
export const PRODUCT_NEG_RE = /\bengineer(ing)?\b|marketing manager/i;

const SALES_RE =
  /\baccount executive\b|sales development|business development|\bsales manager\b|\baccount manager\b|partnerships? manager|enterprise sales|solutions? engineer|\bsales engineer\b|revenue operations|\bsales (lead|director|executive)\b|head of sales|\bsdr\b|\bbdr\b/i;

const MARKETING_RE =
  /marketing|\bgrowth (manager|lead)\b|demand generation|\bbrand manager\b|\bseo (manager|lead|specialist)\b|communications manager/i;

const OPERATIONS_RE =
  /\boperations (manager|lead|director|associate|specialist)\b|business operations|\bbizops\b|chief of staff|\bfinance (manager|lead|director)\b|financial controller|people operations|\bpeople (partner|manager)\b|talent acquisition|\brecruiter\b|human resources|\bhr (manager|business partner|generalist)\b|\boffice manager\b|strategy (and|&) operations|head of operations/i;

// Software-shaped engineering seats per the decided term set (+ the analytics/
// data/ML boundary rule). Deliberately NO bare-"engineer" fallback: hardware /
// mechanical / support engineering seats stay out of a JD-scoreable catalog.
const ENGINEERING_RE =
  /\b(software|backend|back[- ]?end|frontend|front[- ]?end|full[- ]?stack|platform|infrastructure|site reliability|devops|mobile|ios|android|data|machine[- ]learning|ml|ai|security|cloud|qa|test|embedded|blockchain|analytics) engineer(ing)?\b|\bengineering manager\b|\b(staff|principal|senior|founding|lead) engineer\b|\bsoftware developer\b|\bweb developer\b|\bsre\b|\btech(nical)? lead\b|head of engineering|\bvp,? (of )?engineering\b|director of engineering/i;

/** Precedence-ordered [family, matcher] pairs. First match wins. */
const FAMILY_MATCHERS = [
  ["product", (t) => PM_RE.test(t) && !PRODUCT_NEG_RE.test(t)],
  ["sales", (t) => SALES_RE.test(t)],
  ["marketing", (t) => MARKETING_RE.test(t)],
  ["operations", (t) => OPERATIONS_RE.test(t)],
  ["engineering", (t) => ENGINEERING_RE.test(t)],
];

/**
 * Title -> one of ROLE_FAMILIES, or null (out of scope: deferred verticals and
 * everything the five families don't claim). This is the single classifier every
 * writer of `jobs.role_family` goes through — scrape.mjs stamps it centrally,
 * the backfill script replays it over existing rows.
 */
export function classifyRoleFamily(title) {
  const t = title || "";
  if (!t || DEFERRED_RE.test(t)) return null;
  for (const [family, match] of FAMILY_MATCHERS) {
    if (match(t)) return family;
  }
  return null;
}

/** The ingest gate: does this title belong to ANY shipped family? Replaces the
 *  old PM-only `isPM(title)` gate in every source module. */
export const isInScope = (title) => classifyRoleFamily(title) !== null;

/** Kept for callers/tests that ask the narrower question. Same product-family
 *  semantics as the pre-#34 PM-only gate. */
export const isPM = (title) => classifyRoleFamily(title) === "product";

export const EU_RE =
  /europe|emea|united kingdom|\buk\b|ireland|spain|germany|france|netherlands|portugal|sweden|denmark|finland|norway|poland|italy|belgium|austria|switzerland|bulgaria|romania|czech|greece|estonia|lithuania|barcelona|london|berlin|madrid|amsterdam|paris|dublin|munich|lisbon|stockholm|copenhagen|helsinki|oslo|sofia|milan|rome|warsaw|zurich|vienna|brussels|cardiff|manchester|valencia/i;

export const isEU = (location) => !location || EU_RE.test(location);

export function inferSeniority(title) {
  const t = (title || "").toLowerCase();
  if (/founding/.test(t)) return "founding";
  if (/principal|lead|head|director|\bvp\b|group/.test(t)) return "lead";
  if (/senior|\bsr\b/.test(t)) return "senior";
  if (/associate|\bapm\b|junior/.test(t)) return "apm";
  return "pm";
}

export function stripHtml(s) {
  return (s || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
}
