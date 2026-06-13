/**
 * Pure job-filtering helpers shared by the scraper (scripts/scrape.mjs) and its unit
 * tests (src/test/job-filters.test.ts). Kept as plain ESM (no deps) so both can import it.
 * These decide what lands in the shared `jobs` pool — change them only with a test update.
 */

// A Product role title (incl. Product Owner / Head of Product / Founding Product), but NOT
// design / engineering / data / analyst / marketing seats that merely contain "product".
export const PM_RE =
  /\b(product manager|product owner|head of product|group product|principal product|lead product|founding product|director of product|vp,? product|product lead)\b/i;
export const NEG_RE = /designer|product design|\bengineer(ing)?\b|data scien|\banalyst\b|marketing manager/i;
export const EU_RE =
  /europe|emea|united kingdom|\buk\b|ireland|spain|germany|france|netherlands|portugal|sweden|denmark|finland|norway|poland|italy|belgium|austria|switzerland|bulgaria|romania|czech|greece|estonia|lithuania|barcelona|london|berlin|madrid|amsterdam|paris|dublin|munich|lisbon|stockholm|copenhagen|helsinki|oslo|sofia|milan|rome|warsaw|zurich|vienna|brussels|cardiff|manchester|valencia/i;

export const isPM = (title) => PM_RE.test(title || "") && !NEG_RE.test(title || "");
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
