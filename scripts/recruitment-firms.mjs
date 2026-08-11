/**
 * Recruitment-firm / aggregator drop list, ported from the career-ops engine's
 * `recruitment_firms` block (issue #68 item 3). These "companies" front
 * undisclosed clients (agencies, staffing platforms, fractional consultancies,
 * anonymized employers), so a row attributed to them is never a real employer's
 * posting — it must not enter the shared jobs pool at all.
 *
 * Matching is an EXACT normalized-name match (lowercase, diacritics folded,
 * punctuation dropped, trailing legal suffix tolerated) — NEVER a substring
 * match, so "UPPER" cannot swallow "Upper Something GmbH".
 * Pinned by src/test/recruitment-firms.test.ts.
 */

export const RECRUITMENT_FIRMS = [
  // IT / product recruitment agencies
  "Q-tech",
  "Zest Search",
  "Senovo IT Ltd",
  "YourPrime",
  "UPPER",
  "EyeSpy Recruitment",
  "EyeSpy Recruitment - iGaming Specialists",
  "StaffGreat.com",
  "Mackinnon Bruce International",
  "La Fosse",
  "Hays",
  "ManpowerGroup",
  "Fruition Group Ireland",
  "Hartmann Young",
  "Nicoll Curtin",
  "Plexus Tech",
  "Burns Sheehan",
  "My Product Path",
  "Opulent Mind",
  "Ubique Systems",
  "Decskill España",
  // Anonymized employers — no real company behind the listing
  "Confidential",
  "Empresa Confidencial",
  // Fractional-product consultancies fronting client-portfolio roles
  "Product Pulse",
  // Job-aggregator platforms posting "on behalf of a partner company"
  "Jobgether",
];

const LEGAL_SUFFIX_RE = /\s+(ltd|limited|gmbh|inc|llc|s\.?l\.?|s\.?a\.?s?|b\.?v\.?|a\.?b\.?|se)\.?$/i;

/** Normalize a company name for exact-match comparison. */
export function normalizeFirmName(name) {
  let s = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // fold diacritics (España -> Espana)
    .toLowerCase()
    .trim();
  s = s.replace(LEGAL_SUFFIX_RE, "");
  return s.replace(/[^a-z0-9]+/g, "");
}

const FIRM_SET = new Set(RECRUITMENT_FIRMS.map(normalizeFirmName));

/** True when the company name is a known recruitment firm / aggregator. */
export function isRecruitmentFirm(companyName) {
  const norm = normalizeFirmName(companyName);
  return norm.length > 0 && FIRM_SET.has(norm);
}
