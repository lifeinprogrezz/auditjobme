// The ONE company-size vocabulary — `companies.headcount_bucket` (issue #68, item 6).
//
// WHY THIS EXISTS. A pre-filter measurement over the personal engine's golden
// scoring data (planning repo, 2026-07-26) found that company size bucket alone
// recovers about 95% of the deterministic ranker's power. It is, in practice, THE
// signal that decides which roles get scored for a user each day. Before this
// file the column carried TWO overlapping schemes at once — a LinkedIn-shaped
// one (1-10 / 11-50 / 51-200 / 201-500 / 500-2k / 2k+) and a career-ops-shaped
// one (<10 / 10-30 / 30-100 / 100-500 / 500+) — so an 80-person company landed
// in `30-100` or `51-200` purely by which source wrote the row. That is noise
// injected straight into the strongest signal we have.
//
// THE VOCABULARY. Six rungs, contiguous and disjoint: every whole headcount of 1
// or more belongs to exactly one of them, and no headcount belongs to two.
//
//     1-10 · 11-50 · 51-200 · 201-500 · 501-2000 · 2001+
//
// Four of the six rungs sit at or below 500 because the product is about
// European startups and scale-ups: resolution between 10 and 500 is where the
// ranking decisions actually happen, and little is gained by splitting the far
// end. These are also the tokens the sources natively emit (startupmap.one's
// most common sizes, and the shape the enrichment model returns), so the
// normalizer has the fewest judgment calls to make.
//
// THE RULE. Nothing writes `headcount_bucket` except through
// `normalizeHeadcountBucket()`. It returns a member of HEADCOUNT_BUCKETS or
// null, never anything else, so no source can invent a third scheme. The
// database carries the same list as a CHECK constraint
// (supabase/migrations/20260726101000_headcount_vocabulary.sql) and
// src/test/headcount-lib.test.ts fails if the two lists drift apart.
//
// Pure and side-effect-free, so it unit-tests offline.

/** The canonical company-size ladder. The ONLY values `headcount_bucket` may hold. */
export const HEADCOUNT_BUCKETS = Object.freeze([
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-2000",
  "2001+",
]);

/** Upper bound of each rung, aligned with HEADCOUNT_BUCKETS; the last is open-ended. */
const BUCKET_MAX = [10, 50, 200, 500, 2000, Infinity];

/** Is this exactly one of the canonical tokens? */
export function isHeadcountBucket(value) {
  return typeof value === "string" && HEADCOUNT_BUCKETS.includes(value);
}

/** The rung a known headcount falls in. null for junk, zero or negative. */
export function bucketForCount(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return null;
  for (let i = 0; i < BUCKET_MAX.length; i++) {
    if (n <= BUCKET_MAX[i]) return HEADCOUNT_BUCKETS[i];
  }
  return HEADCOUNT_BUCKETS[HEADCOUNT_BUCKETS.length - 1];
}

/**
 * The rung a source's numeric range falls in, by midpoint — the same collapse the
 * app already did at display time, so nothing the product ever distinguished is lost.
 * An open-ended range (no max) is read as "more than min", so `500+` lands in
 * 501-2000 rather than 201-500, matching how such a claim is normally meant.
 */
export function bucketForRange(min, max) {
  const lo = typeof min === "number" && Number.isFinite(min) ? min : null;
  const hi = typeof max === "number" && Number.isFinite(max) ? max : null;
  if (lo == null && hi == null) return null;
  if (lo == null) return bucketForCount(hi);
  if (hi == null) return bucketForCount(lo + 1); // "N+" means more than N
  if (hi < lo) return null;
  return bucketForCount(Math.round((lo + hi) / 2));
}

/** "2k" to 2000 · "1.5k" to 1500 · "300" to 300 · "1,200" to 1200. null if not a number. */
function parseSizeNumber(token) {
  if (!token) return null;
  const m = String(token)
    .replace(/[,\s]/g, "")
    .match(/^(\d+(?:\.\d+)?)(k|m)?$/i);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  const scale = m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1;
  const n = base * scale;
  return n >= 1 && n <= 50_000_000 ? n : null;
}

/** Any unicode dash to "-", lowercase, collapse whitespace. */
function tidy(raw) {
  return String(raw)
    .replace(/[‐-―−]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * THE CHOKEPOINT. Any raw size string from any source becomes a canonical rung, or null.
 *
 * Understands the canonical tokens, both legacy schemes, and the free text the
 * sources actually emit ("~40", "about 200 people", "501-1000", "10 - 30",
 * "5,000+", "under 10"). Anything it cannot read confidently returns null:
 * "we don't know" is a legitimate answer and a wrong bucket is worse than none.
 */
export function normalizeHeadcountBucket(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return bucketForCount(raw);
  if (typeof raw !== "string") return null;

  let s = tidy(raw);
  if (!s) return null;
  if (isHeadcountBucket(s)) return s;

  // Drop the words that decorate a size claim without changing it.
  s = s
    .replace(
      /\b(employees?|people|persons?|staff|colleagues|headcount|team|fte|strong|worldwide|globally)\b/g,
      " ",
    )
    .replace(/\b(approx(?:imately)?|about|around|circa|roughly|ca)\b\.?/g, " ")
    .replace(/[~≈]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  // "under 10" / "fewer than 50" / "<10" — the rung below the stated number.
  const under = s.match(/^(?:<|under |below |fewer than |less than |up to )\s*([\d.,]+k?m?)\+?$/);
  if (under) {
    const n = parseSizeNumber(under[1]);
    return n == null ? null : bucketForCount(Math.max(1, n - 1));
  }

  // "500+" / "over 500" / "more than 2k" — more than the stated number.
  const over =
    s.match(/^(?:over |more than |above |>)?\s*([\d.,]+k?m?)\s*\+$/) ||
    s.match(/^(?:over|more than|above|>)\s*([\d.,]+k?m?)$/);
  if (over) {
    const n = parseSizeNumber(over[1]);
    return n == null ? null : bucketForRange(n, null);
  }

  // "51-200" / "10 - 30" / "1k-5k" / "51 to 200"
  const range = s.match(/^([\d.,]+k?m?)\s*(?:-|to)\s*([\d.,]+k?m?)\+?$/);
  if (range) {
    const lo = parseSizeNumber(range[1]);
    const hi = parseSizeNumber(range[2]);
    return lo == null || hi == null ? null : bucketForRange(lo, hi);
  }

  // A bare count: "240".
  const one = s.match(/^([\d.,]+k?m?)$/);
  if (one) return bucketForCount(parseSizeNumber(one[1]));

  return null;
}

/**
 * Company name to a stable key for cross-source matching (startupmap.one to our
 * catalog). Only legal-entity suffixes are stripped — words like "Group" or
 * "Labs" are part of the identity, and dropping them invites the wrong-company
 * attribution this issue is otherwise trying to fix.
 */
export function companyKey(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(gmbh|ltd|limited|plc|llp|llc|inc|corp|bv|nv|ag|ab|oy|sas|sarl|srl|spa|aps|sl|slu)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

// ── Sources we deliberately do NOT read a size from ──────────────────────────
// Measured against production on 2026-07-26, over the 72 companies with a live
// role and no bucket:
//   · job-description bodies we already store — ONE match in 72 companies, and
//     that one was wrong ("more than 2,000,000 employees" was the size of the
//     customers a security product protects, not the company).
//   · company homepages the enrichment pass already fetches — one truncated
//     schema.org numberOfEmployees and the same false positive.
//   · companies.description — zero matches.
// Near-zero recall with a demonstrated false positive is negative value on the
// field carrying about 95% of the ranker's weight, so neither is wired up. A
// null bucket is an honest answer; a wrong one moves a company in the ranking.
// LinkedIn company pages do carry the size, and 43 of the 72 have a
// linkedin_url on file, but scraping it is off the table: this is a public
// product, it breaks their terms at scale, and the vendor route died with the
// Proxycurl injunction (July 2025). Same reasoning that closed issue #41.
