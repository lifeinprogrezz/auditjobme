// The ONE industry vocabulary — `companies.sector` (issue #70).
//
// WHY THIS EXISTS. The column was written free-form: `enrich-companies.mjs` asked
// a model for "a short industry label e.g. Fintech" and stored whatever came
// back. A 2026-08-19 measurement over the live catalog found 54 distinct strings
// for far fewer real industries — Healthtech / Health Tech / Digital Health were
// three chips for one thing, Data & analytics / Data & Analytics / Data
// Management three more, Edtech / EdTech two, and several single-company strings
// ("Audit Tech / AI", "Food Waste / Marketplace") were enrichment artifacts
// rather than industries. Every split cost the user roles: sector is AND-ed into
// the filter and into the paid scoring prefilter, so picking "Healthtech" silently
// dropped the 43 roles filed under "Health Tech".
//
// THE VOCABULARY. 28 canonical industries (SECTORS). Nothing else may be stored.
// SECTOR_ALIASES folds every variant the catalog actually emitted, plus the
// obvious spelling neighbours, onto one of them. DROPPED_SECTORS names the four
// strings that describe a business MODEL rather than an industry ("SaaS",
// "Software/SaaS", "Enterprise Software", "AI/CX") — they answer a different
// question than the picker asks, so they become null rather than a wrong chip.
//
// THE RULE. Nothing writes `sector` except through `normalizeSector()`. It
// returns a member of SECTORS or null, never anything else, so no enrichment run
// can reintroduce a variant. The database carries the same list as a CHECK
// constraint (supabase/migrations/20260819120000_sector_vocabulary.sql) and
// src/test/sector-lib.test.ts fails if the two lists drift apart. Same shape as
// scripts/headcount-lib.mjs, which solved this for company size on 2026-07-26.
//
// CANONICAL IS NOT THE SAME AS PICKABLE — see the liquidity gate at the foot of
// this file. These 28 are what the column may STORE; what a user may CHOOSE is
// the subset that currently has roles to return.
//
// Pure and side-effect-free, so it unit-tests offline.

/** The canonical industry list. The ONLY values `companies.sector` may hold. */
export const SECTORS = Object.freeze([
  "Fintech",
  "Wealthtech & insurtech",
  "AI & machine learning",
  "Data & analytics",
  "Developer tools & infrastructure",
  "Cybersecurity",
  "Productivity & collaboration",
  "No-code & automation",
  "Sales, marketing & CX tech",
  "HR tech",
  "Legal & compliance tech",
  "Healthtech",
  "Medtech & devices",
  "Biotech",
  "Edtech",
  "Climate tech",
  "Energy",
  "Aerospace & defense",
  "Mobility & transport",
  "Supply chain & logistics",
  "E-commerce & retail",
  "Travel & hospitality",
  "Food & agritech",
  "Real estate & construction tech",
  "Robotics",
  "Hardware, IoT & industrial",
  "Media, entertainment & gaming",
  "Sports & wellness",
]);

/**
 * Every variant seen in the wild, folded onto its canonical industry. Keys are
 * matched case- and punctuation-insensitively (see `tidy`), so only genuinely
 * different WORDS need an entry — "EdTech" and "Edtech" would collapse anyway,
 * and both are listed only because the catalog carried both.
 *
 * A canonical value does not need a self-entry: normalizeSector checks the
 * canonical list first.
 */
export const SECTOR_ALIASES = Object.freeze({
  Fintech: "Fintech",
  "Wealthtech & insurtech": "Wealthtech & insurtech",
  Insurtech: "Wealthtech & insurtech",
  "AI & machine learning": "AI & machine learning",
  AI: "AI & machine learning",
  "Data & analytics": "Data & analytics",
  "Data & Analytics": "Data & analytics",
  "Data Management": "Data & analytics",
  "Developer tools": "Developer tools & infrastructure",
  "Observability and Security": "Developer tools & infrastructure",
  Cybersecurity: "Cybersecurity",
  "Productivity & collaboration": "Productivity & collaboration",
  "Work Management / Productivity Software": "Productivity & collaboration",
  "No-code & automation": "No-code & automation",
  "Sales & marketing tech": "Sales, marketing & CX tech",
  Adtech: "Sales, marketing & CX tech",
  "Customer Service / AI": "Sales, marketing & CX tech",
  "HR tech": "HR tech",
  "Legal & compliance tech": "Legal & compliance tech",
  "Audit Tech / AI": "Legal & compliance tech",
  Healthtech: "Healthtech",
  "Health Tech": "Healthtech",
  "Digital Health": "Healthtech",
  Healthcare: "Healthtech",
  "Medtech & devices": "Medtech & devices",
  Biotech: "Biotech",
  Edtech: "Edtech",
  EdTech: "Edtech",
  "Climate tech": "Climate tech",
  "Circular economy": "Climate tech",
  Energy: "Energy",
  "Aerospace & defense": "Aerospace & defense",
  "Aviation & drones": "Aerospace & defense",
  "aerial data intelligence and unmanned aerial vehicles": "Aerospace & defense",
  "Mobility & transport": "Mobility & transport",
  Mobility: "Mobility & transport",
  Maritime: "Mobility & transport",
  "Supply chain & ops tech": "Supply chain & logistics",
  Logistics: "Supply chain & logistics",
  "E-commerce & retail": "E-commerce & retail",
  "E-commerce": "E-commerce & retail",
  "E-commerce & retail tech": "E-commerce & retail",
  "Fashion & retail tech": "E-commerce & retail",
  "Travel & hospitality": "Travel & hospitality",
  Hospitality: "Travel & hospitality",
  "Food delivery": "Food & agritech",
  "Food Waste / Marketplace": "Food & agritech",
  "Agritech & foodtech": "Food & agritech",
  "Real estate tech": "Real estate & construction tech",
  "Construction tech": "Real estate & construction tech",
  PropTech: "Real estate & construction tech",
  Robotics: "Robotics",
  "Hardware & semiconductors": "Hardware, IoT & industrial",
  "IoT & sensors": "Hardware, IoT & industrial",
  "Manufacturing & production": "Hardware, IoT & industrial",
  "Media & entertainment": "Media, entertainment & gaming",
  Gaming: "Media, entertainment & gaming",
  "Social & creator economy": "Media, entertainment & gaming",
  "Sports & wellness": "Sports & wellness",
});

/**
 * Strings that name a business MODEL or a delivery mechanism, not an industry.
 * "SaaS" is true of most of the catalog and tells a job-seeker nothing about the
 * space they would be working in, so it is not a chip anyone can act on. Listed
 * explicitly rather than left to fall through, so a reader can see the call was
 * deliberate and a future alias never accidentally revives one.
 */
export const DROPPED_SECTORS = Object.freeze([
  "SaaS",
  "Software/SaaS",
  "Enterprise Software",
  "AI/CX",
]);

/** Lowercase, unify dashes and ampersands, reduce punctuation to single spaces. */
function tidy(raw) {
  return String(raw)
    .replace(/[‐-―−]/g, "-")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** tidy(key) → canonical, for the canonical list, the aliases and the drops. */
const LOOKUP = new Map();
for (const s of SECTORS) LOOKUP.set(tidy(s), s);
for (const [variant, canonical] of Object.entries(SECTOR_ALIASES)) LOOKUP.set(tidy(variant), canonical);
for (const s of DROPPED_SECTORS) LOOKUP.set(tidy(s), null);

/** Is this exactly one of the canonical industries? */
export function isSector(value) {
  return typeof value === "string" && SECTORS.includes(value);
}

/**
 * THE CHOKEPOINT. Any raw industry string from any source becomes a canonical
 * industry, or null.
 *
 * Deliberately NOT fuzzy. It recognises the canonical names, the known variants
 * and the dropped model-words, and returns null for everything else. A wrong
 * industry is worse than none: it puts a company behind a chip its roles do not
 * belong to, and the user who picks that chip never sees the roles they wanted.
 * When a new variant starts appearing, add it to SECTOR_ALIASES — that is one
 * edit and one test, and it leaves a record of the judgment.
 */
export function normalizeSector(raw) {
  if (typeof raw !== "string") return null;
  const key = tidy(raw);
  if (!key) return null;
  return LOOKUP.get(key) ?? null;
}

// ── The liquidity gate ───────────────────────────────────────────────────────
// CANONICAL IS NOT THE SAME AS PICKABLE. The 28 values above are what the column
// may STORE. What a user may CHOOSE is the subset that can actually return roles,
// recomputed from the live catalog every time a picker renders — never a stored
// list, because a stored list goes stale silently and an empty result reads as
// "no jobs for me" rather than "we do not cover that".
//
// A canonical industry is offered only when, across roles that are live RIGHT
// NOW, it has at least MIN_SECTOR_EMPLOYERS distinct hiring employers AND at
// least MIN_SECTOR_ROLES live roles. Both conditions must hold.
//
// WHY EMPLOYERS DECIDE AND ROLES ONLY GUARD (measured 2026-08-19, live catalog):
//   1. One bad row cannot make an industry. The largest single-employer group in
//      the catalog is a mislabelled company: a role count alone would have
//      promoted that one error into a 108-role chip. Three independent employers
//      cannot be manufactured by one wrong attribution.
//   2. Sector is AND-ed with city, role family, seniority and size. One employer
//      means one location set and one hiring style, so the intersection
//      collapses. "Sports & wellness" carries 23 live roles across ONE employer,
//      of which two are product roles; "Media & entertainment" carries four roles
//      and no product roles. Either chip returns an empty page.
//   3. One employer closing a hiring wave takes the industry to zero in a single
//      scrape. Over the 30 days to 2026-08-19, "Mobility & transport" went from
//      five hiring employers to three.
//   4. Role count does not discriminate: the one-employer "Sports & wellness"
//      (23 roles) outranks the five-employer "No-code & automation" (25). By
//      employers the two separate cleanly.
//
// WHY 3 AND 20. Employer counts per canonical industry run 58, 44, 16, 15, 13,
// 12, 11, 11, 9, 9, 8, 8, 8, 7, 7, 6, 5, 5, 5, 5, 4, 3, then fall to 2, 2, 1, 1,
// 0 — so 3 sits inside a natural gap and a one-employer swing flips nothing. The
// role floor binds on nothing today (the lowest passing industry has 25); it
// exists for the day a dominant employer leaves. "Food & agritech" is 82% one
// employer, and without the floor it would keep its chip on 14 leftover roles.
//
// WHAT FAILING MEANS. Nothing is hidden. Sector is opt-in and an empty selection
// shows everything, so a failing industry's roles stay in the default view and
// stay reachable by city, role, size and search. Only the CHOICE is withheld,
// because that choice is the thing that would return an empty page.

/** Distinct hiring employers an industry needs before it may be offered. */
export const MIN_SECTOR_EMPLOYERS = 3;

/** Live roles an industry needs before it may be offered. A guard, not a selector. */
export const MIN_SECTOR_ROLES = 20;

/** Can a user be offered this industry? Both conditions must hold. */
export function isPickableSector(stat) {
  if (!stat) return false;
  return (
    (stat.employers ?? 0) >= MIN_SECTOR_EMPLOYERS && (stat.count ?? 0) >= MIN_SECTOR_ROLES
  );
}
