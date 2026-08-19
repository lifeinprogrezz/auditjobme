// The industry picker's liquidity gate (issue #70) — client side.
//
// The vocabulary itself lives in scripts/sector-lib.mjs, next to the writer-side
// normalizer and the SQL CHECK that pins the column. This module is the other
// half of the same rule: canonical is what the column may STORE, pickable is what
// a user may CHOOSE, and the second is recomputed from the live catalog rather
// than stored anywhere.
//
// WHAT THIS REPLACES. src/lib/labels.ts used to carry FALLBACK_SECTORS — twelve
// hardcoded industry names offered whenever the catalog looked empty. Measured on
// 2026-08-19, eight of the twelve matched ZERO live roles: "Crypto", "AI/ML",
// "Marketplace", "SaaS/B2B", "Consumer", "DevTools", "Health" and "Climate" are
// not strings the catalog uses. A user who picked one got an empty result they
// would read as "no jobs for me". A list that can lie is worse than no list, so
// the fallback is gone: with nothing live to derive from, the picker shows
// nothing.
//
// WHERE THE GATE BINDS. On the TARGET picker (CvUnlockModal and SettingsPanel),
// because that pick carries no visible count and is AND-ed into the paid scoring
// prefilter, where a miss costs the user their whole score run. The /roles
// HeadBar facet derives from the filtered live pool and renders a count beside
// every option, so it needs the canonical vocabulary but NOT the gate — a visible
// count is its own honesty mechanism.
//
// Pinned by src/test/sector-lib.test.ts. Rule and code move together: the
// thresholds are named constants in scripts/sector-lib.mjs, next to the
// vocabulary, so a recalibration is one edit and one test.
import {
  MIN_SECTOR_EMPLOYERS,
  MIN_SECTOR_ROLES,
  SECTORS,
  isPickableSector,
  isSector,
  normalizeSector,
} from "../../scripts/sector-lib.mjs";

export { MIN_SECTOR_EMPLOYERS, MIN_SECTOR_ROLES, SECTORS, isPickableSector, isSector, normalizeSector };

/**
 * A stored `profiles.target_sectors` (or CV-stash) array → canonical industries.
 *
 * The migration rewrites what is already in the database, so the one source of
 * stale values left is a localStorage CV stash written by the PREVIOUS bundle and
 * read back after the deploy, across the OAuth redirect. Without this it would
 * carry a retired variant ("Health Tech") straight into a fresh profile row and
 * match nothing. Unmappable values are dropped; an empty result reads as "no
 * industry preference", which shows everything.
 */
export function normalizeTargetSectors(stored: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const v of stored ?? []) {
    const s = normalizeSector(v);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** A live-catalog row, reduced to what the gate reads. */
export type SectorCountable = {
  sector?: string | null;
  /** companies.slug — the stable employer identity. */
  company_id?: string | null;
  /** Scraped company name, the fallback identity when no company row is linked. */
  company?: string | null;
};

/** One industry's live liquidity: how many roles, and how many distinct employers. */
export type SectorStat = { value: string; label: string; count: number; employers: number };

/**
 * Live liquidity per industry, richest first.
 *
 * Employers are counted on `company_id` (companies.slug) and fall back to the
 * scraped name, so two scrapes of one company never read as two employers. Rows
 * with no sector are skipped: about 62% of the live catalog has none, and a
 * sector selection is AND-ed across, so those roles belong to no industry here.
 * That is exactly why an empty selection must keep showing everything.
 */
export function sectorLiquidity(jobs: SectorCountable[]): SectorStat[] {
  const byS = new Map<string, { count: number; employers: Set<string> }>();
  for (const j of jobs) {
    const s = j.sector;
    if (!s) continue;
    let e = byS.get(s);
    if (!e) byS.set(s, (e = { count: 0, employers: new Set<string>() }));
    e.count++;
    const employer = j.company_id ?? j.company;
    if (employer) e.employers.add(employer);
  }
  return [...byS.entries()]
    .map(([value, e]) => ({ value, label: value, count: e.count, employers: e.employers.size }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * The industries a user may be offered: those with enough live employers AND
 * enough live roles to return something.
 *
 * `keep` re-admits an industry the user has ALREADY chosen even when it no longer
 * passes. Dropping a stored choice out of the picker would leave them staring at
 * a saved target they cannot see or clear, and it would look like the app forgot
 * it — the gate exists to stop a NEW pick going nowhere, not to erase an old one.
 */
export function pickableSectors(stats: SectorStat[], keep: string[] = []): SectorStat[] {
  const kept = new Set(keep);
  return stats.filter((s) => isPickableSector(s) || kept.has(s.value));
}
