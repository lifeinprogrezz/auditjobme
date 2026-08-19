// Pure, side-effect-free helpers for the company-context enrichment batch
// (scripts/enrich-companies.mjs). GROUNDED discipline: every value is quoted from
// a real source (a JD, a site's meta tags, or Wikidata) or it is null — never
// guessed. Kept pure so they can be unit-tested (src/test/enrich-lib.test.ts).

import { normalizeSector } from "./sector-lib.mjs";

// Matches the app's model choice (src/lib/score.ts, src/lib/tailor.ts).
export const MODEL = "claude-haiku-4-5-20251001";

/** Collapse a candidate description to one clean line, capped; null if too short/empty. */
export function sanitizeDescription(s) {
  if (!s || typeof s !== "string") return null;
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length < 12) return null;
  return clean.length > 240 ? clean.slice(0, 237).trimEnd() + "…" : clean;
}

/** Decode the handful of HTML entities that show up in meta tags. */
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Parse the Haiku extraction JSON (prose-tolerant, like parseScoreResponse).
 * Returns a PARTIAL object holding only the fields that are present and valid —
 * absent/invalid fields are dropped, so a caller only ever writes real values.
 */
export function parseEnrichment(text) {
  if (!text || typeof text !== "string") return {};
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  const desc = sanitizeDescription(obj.description);
  if (desc) out.description = desc;
  // The parse boundary is where a model answer becomes a field, so the industry
  // vocabulary is enforced HERE too (issue #70): nothing downstream ever sees a
  // free-text sector. An answer outside the 28 canonical industries is dropped
  // rather than stored — a wrong industry files a company behind a chip its roles
  // do not belong to, and the user who picks that chip never sees them.
  const sector = normalizeSector(obj.sector);
  if (sector) out.sector = sector;
  if (typeof obj.stage === "string" && obj.stage.trim()) out.stage = obj.stage.trim().toLowerCase().slice(0, 40);
  if (typeof obj.team_size === "string" && obj.team_size.trim()) out.team_size = obj.team_size.trim().slice(0, 40);
  const yr = Number(obj.founded_year);
  if (Number.isInteger(yr) && yr >= 1800 && yr <= 2100) out.founded_year = yr;
  return out;
}

/** Extract a company one-liner from page HTML: og:description, then <meta name=description>. */
export function metaDescription(html) {
  if (!html || typeof html !== "string") return null;
  const patterns = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return sanitizeDescription(decodeEntities(m[1]));
  }
  return null;
}

/** Parse a Wikidata P571 (inception) time "+2013-00-00T00:00:00Z" → 2013; null if out of range. */
export function parseWikidataTime(t) {
  if (!t || typeof t !== "string") return null;
  const m = t.match(/^[+-](\d{4})-/);
  if (!m) return null;
  const yr = Number(m[1]);
  return yr >= 1800 && yr <= 2100 ? yr : null;
}

/** Pull a company's LinkedIn URL from its page HTML (footer/social links) →
 *  canonical https://www.linkedin.com/company/<slug>, or null. GROUNDED: only what
 *  the site itself links, never a guessed slug. */
export function linkedinFromHtml(html) {
  if (!html || typeof html !== "string") return null;
  const m = html.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([A-Za-z0-9_%.-]+)/i);
  if (!m) return null;
  const slug = m[1].replace(/\/+$/, "").split(/[?#]/)[0];
  if (!slug || slug.length > 100) return null;
  return `https://www.linkedin.com/company/${slug}`;
}
