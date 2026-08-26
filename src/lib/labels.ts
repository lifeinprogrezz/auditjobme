// Phase A (overnight-job-hunter, spec 2026-07-07): the CV-unlock front door's
// pure logic — CV hashing, the ROLE vocabulary, the role-matching rule, the
// industry chip helpers, the label→scoring-slice filter, and the localStorage
// stash that survives the Google-OAuth full-page redirect.
// The INDUSTRY vocabulary lives in scripts/sector-lib.mjs with its writer-side
// normalizer, and its liquidity gate in src/lib/sectors.ts — deliberately not
// here, because this module is reachable from api/ and must stay light.
// Pinned by src/test/labels.test.ts.
import type { RoleJob } from "@/lib/roles";
import { ROLE_FAMILY_LABELS, type RoleFamily } from "./scorePrompt.js";

// ── The ONE role vocabulary (issue #70) ──────────────────────────────────────
// Three vocabularies used to be live at once: these ten Title-Case archetypes in
// the pickers, the five lowercase `jobs.role_family` values in the database, and
// the raw family string in the /roles Role facet, which showed the user chips
// reading "engineering", "sales", "product". A user could not express the same
// idea on two surfaces, and the words did not match.
//
// The five families win, because they are what the catalog is labelled with and
// what the scorer already branches on. Their display names are ROLE_FAMILY_LABELS
// from scorePrompt.ts, reused rather than reinvented — a fourth spelling of
// "Sales" is the thing this issue exists to remove.

/** The five role verticals, in the order the pickers render them. */
export const ROLE_FAMILIES: readonly RoleFamily[] = [
  "product",
  "engineering",
  "sales",
  "marketing",
  "operations",
] as const;

/** Picker chips: the stored value plus the one display name for it. */
export const ROLE_FAMILY_OPTIONS: { value: RoleFamily; label: string }[] = ROLE_FAMILIES.map(
  (value) => ({ value, label: ROLE_FAMILY_LABELS[value] }),
);

/**
 * Retired picker archetypes → the family that now carries them. Five mapped 1:1
 * onto a family already; the other five had no family at all, and a naive switch
 * would have matched them to nothing — a stored "Growth" would have emptied that
 * user's scoring slice and put permanent "Not scored" copy on every card, which
 * reads as a scoring outage rather than a vocabulary change.
 *
 * The five family-less dispositions, decided explicitly:
 *   Growth   → marketing   (growth seats classify as marketing in job-filters.mjs)
 *   Data     → engineering (the same boundary rule: data, machine-learning and
 *                           analytics engineering are engineering; analyst and
 *                           scientist seats are a DEFERRED vertical and are not
 *                           in the catalog at all)
 *   Strategy → operations  (chief-of-staff and strategy-and-operations seats)
 *   Founding → product     (a founding seat in this catalog is a product seat)
 *   Design   → null        (a deferred vertical with no home — see
 *                           normalizeTargetRoles for what happens to the value)
 */
export const FAMILY_BY_ARCHETYPE: Record<string, RoleFamily> = {
  Product: "product",
  Engineering: "engineering",
  Marketing: "marketing",
  "Sales/BD": "sales",
  Operations: "operations",
  Growth: "marketing",
  Data: "engineering",
  Strategy: "operations",
  Founding: "product",
};

/** Is this one of the five families? */
export function isRoleFamily(value: unknown): value is RoleFamily {
  return typeof value === "string" && (ROLE_FAMILIES as readonly string[]).includes(value);
}

/**
 * Any stored target-role value → a family, or null when it maps to none.
 *
 * Accepts a family (already current), a retired archetype, and "Product Manager"
 * — the string the Role facet used to show for unlabelled rows and the one the
 * dev fixture seeded, which belonged to none of the three old vocabularies.
 */
export function archetypeToFamily(value: string | null | undefined): RoleFamily | null {
  if (!value) return null;
  if (isRoleFamily(value)) return value;
  if (value === "Product Manager") return "product";
  return FAMILY_BY_ARCHETYPE[value] ?? null;
}

/**
 * A stored `profiles.target_roles` (or CV-stash) array → current families.
 *
 * Unmappable values are DROPPED rather than kept, and dropping the last one
 * leaves an empty array — which every consumer reads as "no role preference" and
 * therefore as "everything is eligible". That is the non-stranding answer: a user
 * whose only pick was the retired "Design" gets the whole catalog back, not an
 * empty scoring slice and a permanently "Not scored" map.
 */
export function normalizeTargetRoles(stored: readonly string[] | null | undefined): RoleFamily[] {
  const out: RoleFamily[] = [];
  for (const v of stored ?? []) {
    const f = archetypeToFamily(v);
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

/**
 * Does this row satisfy the user's chosen roles? The ONE role-matching rule, so
 * the nightly digest and the paid backlog worker can never disagree about what a
 * label means. They did: the nightly matched on the title regex alone, which
 * finds 65% of live `sales` rows and 48% of live `operations` rows.
 *
 * Hybrid on purpose. The family is the primary key — it is what the catalog is
 * labelled with, and it is far more complete than any title inference. The title
 * archetype is the fallback, covering rows with no family and any legacy
 * archetype still sitting in a profile or in a pre-deploy CV stash.
 */
export function roleMatchesTargets(
  job: { title: string; role_family?: string | null },
  roles: readonly string[],
): boolean {
  if (roles.length === 0) return true;
  const families = normalizeTargetRoles(roles);
  if (job.role_family != null && families.includes(job.role_family as RoleFamily)) return true;
  const archetype = roleArchetypeOf(job.title);
  if (archetype == null) return false;
  if (roles.includes(archetype)) return true; // a legacy archetype, matched by title
  const inferred = archetypeToFamily(archetype);
  return inferred != null && families.includes(inferred);
}

/** Title-inference archetypes. NOT a picker vocabulary any more (issue #70) —
 *  this is the internal keyword taxonomy roleArchetypeOf emits, used only as the
 *  fallback in roleMatchesTargets when a row carries no `role_family`. */
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

/** How many target-role chips a user may select (issue #156, LOCKED decision 1:
 *  fewer roles = a smaller, sharper paid scoring slice). Roles are AND-ed into
 *  the slice, so this stays tighter than SECTOR_CAP below. */
export const ROLE_CAP = 2;

/** How many target-industry chips a user may select. Industries are OR-ed
 *  inside the slice, so this can sit one higher than ROLE_CAP without widening
 *  the run as much (issue #156, LOCKED decision 1). */
export const SECTOR_CAP = 3;

/** How many industry chips the CV-unlock modal always shows (top by live-role
 *  frequency) before the tail's search row (issue #44). A DISPLAY cap, distinct
 *  from SECTOR_CAP (the selection cap) — this one just bounds how much of the
 *  ~50-sector catalog renders as chips vs. lives behind search. */
export const TOP_SECTOR_CHIPS = 12;

type SectorOption = { value: string; label: string; count: number };

/**
 * Chips to render in the CV-unlock modal's industry picker: the top N sectors
 * by frequency (sectorOptions arrives pre-sorted desc), PLUS any already-
 * selected sector that falls outside the top N — a picked tail sector can
 * never disappear from view (issue #44, rule 3).
 *
 * An empty catalog now renders NOTHING (issue #70). It used to fall back to a
 * hardcoded FALLBACK_SECTORS list, eight of whose twelve entries matched zero
 * live roles — so the picker offered choices that could only ever return an
 * empty page. Showing nothing is the honest answer; see src/lib/sectors.ts.
 */
export function visibleSectorChips(
  sectorOptions: SectorOption[],
  selected: string[],
  topN: number = TOP_SECTOR_CHIPS,
): string[] {
  if (sectorOptions.length === 0) return [];
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

/** Infer a coarse function archetype from a role title — the FALLBACK for rows
 *  the catalog left unlabelled (roleMatchesTargets). Product wins for any PM
 *  title; other functions fall out of keyword hits; null when nothing matches.
 *  Title inference is lossy by nature (it misses a third of live sales rows and
 *  half the operations rows), which is why `jobs.role_family` leads. */
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
 * any LLM call (the primary cost lever, spec §3). A job passes when it satisfies
 * the chosen roles AND its sector is among the chosen sectors (each dimension
 * ignored when its selection is empty — OR-within, AND-across, mirroring
 * filterJobs). With no labels, or when the filter would empty the slice, fall
 * back to the full list so the reveal always has something to score.
 *
 * The role test is roleMatchesTargets, the same rule the paid backlog prefilter
 * uses (issue #70). It used to be the title regex alone, so the nightly digest
 * and the backlog worker disagreed about what a label meant — the nightly found
 * only 65% of live `sales` rows and 48% of live `operations` rows.
 */
export function pickScoringSlice<T extends Pick<RoleJob, "title" | "sector" | "role_family">>(
  jobs: T[],
  labels: Labels,
): T[] {
  const roles = labels.roles ?? [];
  const sectors = labels.sectors ?? [];
  if (roles.length === 0 && sectors.length === 0) return jobs;
  const filtered = jobs.filter((j) => {
    const sectorOk = sectors.length === 0 || (j.sector != null && sectors.includes(j.sector));
    return roleMatchesTargets(j, roles) && sectorOk;
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
