// Phase A (overnight-job-hunter, spec 2026-07-07): the CV-unlock front door's
// pure logic — CV hashing, the role/industry label vocabularies, the role
// archetype inference, the label→scoring-slice filter, and the localStorage
// stash that survives the Google-OAuth full-page redirect.
// Pinned by src/test/labels.test.ts.
import type { RoleJob } from "@/lib/roles";

/** Target-role archetypes the user can pick (cap 3). Product-first: the catalog
 *  is PM-centric today, so most roles infer to Product (see roleArchetypeOf). */
export const ROLE_ARCHETYPES = [
  "Product",
  "Growth",
  "Data",
  "Design",
  "Engineering",
  "Marketing",
  "Sales/BD",
  "Operations",
  "Strategy",
  "Founding",
] as const;
export type RoleArchetype = (typeof ROLE_ARCHETYPES)[number];

/** Fallback industry list when the live catalog has no sector data to derive from.
 *  When sectors exist we offer the ACTUAL sector strings so the filter matches. */
export const FALLBACK_SECTORS = [
  "Fintech",
  "Health",
  "Climate",
  "Crypto",
  "AI/ML",
  "Marketplace",
  "SaaS/B2B",
  "Consumer",
  "Gaming",
  "DevTools",
  "Mobility",
  "Edtech",
];

/** How many label chips of each kind a user may select. */
export const LABEL_CAP = 3;

/** How many industry chips the CV-unlock modal always shows (top by live-role
 *  frequency) before the tail's search row (issue #44). A DISPLAY cap, distinct
 *  from LABEL_CAP (the selection cap, parked at #35) — this one just bounds how
 *  much of the ~50-sector catalog renders as chips vs. lives behind search. */
export const TOP_SECTOR_CHIPS = 12;

type SectorOption = { value: string; label: string; count: number };

/**
 * Chips to render in the CV-unlock modal's industry picker: the top N sectors
 * by frequency (sectorOptions arrives pre-sorted desc), PLUS any already-
 * selected sector that falls outside the top N — a picked tail sector can
 * never disappear from view (issue #44, rule 3). Falls back to
 * FALLBACK_SECTORS when the live catalog has nothing to derive from.
 */
export function visibleSectorChips(
  sectorOptions: SectorOption[],
  selected: string[],
  topN: number = TOP_SECTOR_CHIPS,
): string[] {
  if (sectorOptions.length === 0) return FALLBACK_SECTORS;
  const top = sectorOptions.slice(0, topN).map((o) => o.value);
  const topSet = new Set(top);
  const strandedSelected = selected.filter((s) => !topSet.has(s));
  return [...top, ...strandedSelected];
}

/**
 * Typeahead search over the sector catalog for the CV-unlock modal's compact
 * "more industries" row (issue #44) — matches on label, excludes anything
 * already shown as a visible chip so results never duplicate the chip row.
 * Empty query returns no results (keeps the row compact until the user types).
 */
export function filterSectorSearch(
  sectorOptions: SectorOption[],
  visible: string[],
  query: string,
): SectorOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const visibleSet = new Set(visible);
  return sectorOptions.filter((o) => !visibleSet.has(o.value) && o.label.toLowerCase().includes(needle));
}

/**
 * Deterministic, dependency-free hash of a CV's trimmed text (djb2 xor variant,
 * base36). Same CV → same hash (a re-submit is a no-op for the score cache); any
 * edit → a new hash (re-score). Leading/trailing whitespace never changes it.
 */
export function hashCv(text: string): string {
  const s = (text ?? "").trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/** Word count for CV-state display (CV-unlock read state, profile view). Shared
 *  so "N words" always means the same thing wherever a stored/parsed CV is shown. */
export function cvWordCount(text: string | null | undefined): number {
  const t = (text ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Human "uploaded" date for the profile view (day + short month + year, matching
 *  Tracker.tsx's applied-date format). Null when there's no timestamp to show. */
export function formatUploadedDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Infer a coarse function archetype from a role title. Product wins for any PM
 *  title (the PM-centric catalog); other functions fall out of keyword hits;
 *  null when nothing matches (that role then can't satisfy a role-label filter). */
export function roleArchetypeOf(title: string | null | undefined): RoleArchetype | null {
  const t = (title ?? "").toLowerCase();
  if (!t) return null;
  // PM titles → Product first, so a "Founding Product Manager" still matches a
  // Product-picker (founding non-PM roles fall through to Founding below).
  if (
    /product manager|product owner|product lead|head of product|group product|principal product|senior product|staff product|director of product|chief product|founding product|product marketing/.test(
      t,
    )
  )
    return t.includes("product marketing") ? "Marketing" : "Product";
  if (/growth|acquisition|lifecycle|retention|\bcrm\b/.test(t)) return "Growth";
  if (/data|analyt|scientist|machine learning|\bml\b/.test(t)) return "Data";
  if (/design|\bux\b|\bui\b|research/.test(t)) return "Design";
  if (/engineer|developer|software|\bswe\b/.test(t)) return "Engineering";
  if (/market/.test(t)) return "Marketing";
  if (/\bsales\b|business development|\bbd\b|account exec|revenue/.test(t)) return "Sales/BD";
  if (/operation|\bops\b|logistics/.test(t)) return "Operations";
  if (/strateg|chief of staff/.test(t)) return "Strategy";
  if (/founding|founder|\bceo\b|\bcoo\b/.test(t)) return "Founding";
  if (/product/.test(t)) return "Product";
  return null;
}

export type Labels = { roles: string[]; sectors: string[] };

/**
 * The deterministic scoring slice: narrow the catalog to the user's labels before
 * any LLM call (the primary cost lever, spec §3). A job passes when its inferred
 * archetype is among the chosen roles AND its sector is among the chosen sectors
 * (each dimension ignored when its selection is empty — OR-within, AND-across,
 * mirroring filterJobs). With no labels, or when the filter would empty the slice,
 * fall back to the full list so the reveal always has something to score.
 */
export function pickScoringSlice<T extends Pick<RoleJob, "title" | "sector">>(
  jobs: T[],
  labels: Labels,
): T[] {
  const roles = labels.roles ?? [];
  const sectors = labels.sectors ?? [];
  if (roles.length === 0 && sectors.length === 0) return jobs;
  const filtered = jobs.filter((j) => {
    const roleOk = roles.length === 0 || roles.includes(roleArchetypeOf(j.title) ?? "");
    const sectorOk = sectors.length === 0 || (j.sector != null && sectors.includes(j.sector));
    return roleOk && sectorOk;
  });
  return filtered.length ? filtered : jobs;
}

// ── localStorage stash (survives the OAuth full-page redirect) ──────────────
// The key keeps its pre-rebrand prefix ON PURPOSE (#106). It names a slot in
// browsers we do not control, so renaming it orphans the stash of everyone who is
// mid sign-up, and they lose the CV they just pasted. Moving it needs a
// read-old/write-new migration, never a find-and-replace.
export const CV_STASH_KEY = "auditjobme.cvStash";
export type CvStash = {
  cv_text: string;
  cv_hash: string;
  target_roles: string[];
  target_sectors: string[];
};

/** Read + validate the pre-redirect CV stash. Returns null on absence or any
 *  malformed / empty payload (never throws — localStorage can be unavailable). */
export function readCvStash(): CvStash | null {
  try {
    const raw = localStorage.getItem(CV_STASH_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<CvStash>;
    if (typeof p?.cv_text !== "string" || !p.cv_text.trim()) return null;
    return {
      cv_text: p.cv_text,
      cv_hash: typeof p.cv_hash === "string" && p.cv_hash ? p.cv_hash : hashCv(p.cv_text),
      target_roles: Array.isArray(p.target_roles) ? p.target_roles.filter((x) => typeof x === "string") : [],
      target_sectors: Array.isArray(p.target_sectors)
        ? p.target_sectors.filter((x) => typeof x === "string")
        : [],
    };
  } catch {
    return null;
  }
}

/** Persist the stash. Returns false when localStorage rejects the write (Safari
 *  private browsing / quota) so the caller can abort the OAuth redirect rather
 *  than send the user through sign-in with a doomed stash that will silently
 *  vanish across the full-page redirect. */
export function writeCvStash(stash: CvStash): boolean {
  try {
    localStorage.setItem(CV_STASH_KEY, JSON.stringify(stash));
    return true;
  } catch {
    return false; // localStorage unavailable (private mode / quota)
  }
}

export function clearCvStash(): void {
  try {
    localStorage.removeItem(CV_STASH_KEY);
  } catch {
    /* ignore */
  }
}
