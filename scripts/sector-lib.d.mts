// Types for scripts/sector-lib.mjs (issue #70).
//
// The vocabulary lives in the .mjs because the scrapers and the enrichment writer
// are plain Node and cannot import TypeScript. This declaration exists so the
// TYPED side can import the same module instead of keeping a second copy of the
// alias map — two sources of a vocabulary is the exact failure this issue closes.
//
// It matters for api/ specifically: the scoring prefilter normalizes stored
// sector labels, and both the browser and the Vercel functions must resolve a
// legacy value identically or they select different slices. api/tsconfig.json is
// stricter than the app config and rejects an untyped .mjs import, so without
// this file the server could not share the normalizer at all.

/** The canonical sectors. The only values companies.sector may hold. */
export const SECTORS: readonly string[];

/** Raw catalogue string -> canonical sector. */
export const SECTOR_ALIASES: Readonly<Record<string, string>>;

/** Strings with no canonical home; these normalize to null rather than a guess. */
export const DROPPED_SECTORS: readonly string[];

/** True when the value is already canonical. */
export function isSector(value: unknown): boolean;

/** Canonical form of any raw string, or null when it has no home. Never fuzzy. */
export function normalizeSector(raw: string | null | undefined): string | null;

/** Distinct hiring employers a sector needs before a user may pick it. */
export const MIN_SECTOR_EMPLOYERS: number;

/** Live roles a sector needs before a user may pick it. */
export const MIN_SECTOR_ROLES: number;

/** True when a sector clears both liquidity floors. `count` is live roles; the
 *  field is named for the shape sectorLiquidity() already produces. */
export function isPickableSector(stat: { employers: number; count: number } | null | undefined): boolean;
