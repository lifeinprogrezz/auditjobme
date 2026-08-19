// Per-user scoring prefilter (issue #114): the deterministic prune that runs
// BEFORE any paid score call. The all-vertical merge grew the live catalog to
// ~8K rows, so an unfiltered CV signup cost ~$19; this narrows the pass to the
// user's chosen targets with a hard cost ceiling. Shared by the backlog worker
// (api/score-backlog.ts — what gets paid for) and useRolesData (what "still
// scoring" means) — the two MUST agree or /roles polls forever.
// Client-import-free (like labels.ts). Pinned by src/test/score-prefilter.test.ts.
// Spec: planning repo docs/specs/2026-08-19-score-backlog-prefilter-design.md.
import { roleArchetypeOf, type Labels } from "./labels";

/** Hard per-user slice ceiling (~$3.60 at ~$0.0024/batch-score). A cost dial,
 *  not a scoring judgment — the cap sheds the OLDEST rows, so the slice is
 *  always the freshest N matching roles. */
export const PREFILTER_CAP = 1500;

/** Slice ceiling when the user gave no usable labels (~$2.40). Deliberately
 *  NOT the full catalog — pickScoringSlice's full-list fallback is exactly the
 *  $19 failure this module exists to close. */
export const FALLBACK_CAP = 1000;

/** The five archetypes that map 1:1 onto jobs.role_family (#34). The other
 *  five (Growth/Data/Design/Strategy/Founding) have no family — they match
 *  via roleArchetypeOf(title) below. */
export const FAMILY_BY_ARCHETYPE: Record<string, string> = {
  Product: "product",
  Engineering: "engineering",
  Marketing: "marketing",
  "Sales/BD": "sales",
  Operations: "operations",
};

export type PrefilterJob = {
  title: string;
  role_family?: string | null;
  sector?: string | null;
  first_seen_at?: string | null;
  posted_at?: string | null;
};

/** When this row appeared, epoch ms: first_seen_at → posted_at → 0 (unknown
 *  sorts last, but is never filtered out — fail-open on missing dates). */
function seenMs(j: PrefilterJob): number {
  const t = Date.parse(j.first_seen_at ?? "") || Date.parse(j.posted_at ?? "");
  return Number.isFinite(t) && t > 0 ? t : 0;
}

/** Role dimension: the row's family is among the families the chosen
 *  archetypes map to, OR its title infers to a chosen archetype (covers
 *  family-less archetypes and role_family=null rows). */
function roleOk(j: PrefilterJob, roles: string[]): boolean {
  if (roles.length === 0) return true;
  const families = roles.map((r) => FAMILY_BY_ARCHETYPE[r]).filter(Boolean);
  if (j.role_family != null && families.includes(j.role_family)) return true;
  return roles.includes(roleArchetypeOf(j.title) ?? "");
}

/** Sector dimension: OR-within, AND-across (same semantics as
 *  pickScoringSlice and the map filter — a null-sector row does not pass a
 *  sector selection). */
function sectorOk(j: PrefilterJob, sectors: string[]): boolean {
  if (sectors.length === 0) return true;
  return j.sector != null && sectors.includes(j.sector);
}

/**
 * The prefilter: label-matching rows, newest-first, capped at PREFILTER_CAP.
 * No labels — or labels that match nothing — fall back to the newest
 * FALLBACK_CAP rows of the whole list (never empty, never the full catalog).
 */
/** How a role's fit should be presented. Before the prefilter, every unscored
 *  role was genuinely mid-pass; now a role outside the paid slice never scores,
 *  so "scoring…" copy would be a permanent lie. Pinned by score-status.test.ts. */
export type ScoreStatus = "scored" | "scoring" | "not-scored";

/** The single decision point for that distinction — every surface that renders a
 *  pending state MUST route through here rather than testing `score == null`. */
export function scoreStatusOf(score: number | null | undefined, eligible: boolean): ScoreStatus {
  if (score != null) return "scored";
  return eligible ? "scoring" : "not-scored";
}

export function prefilterJobs<T extends PrefilterJob>(jobs: T[], labels: Labels): T[] {
  const roles = labels.roles ?? [];
  const sectors = labels.sectors ?? [];
  const byNewest = (a: T, b: T) => seenMs(b) - seenMs(a);
  const matched =
    roles.length === 0 && sectors.length === 0
      ? []
      : jobs.filter((j) => roleOk(j, roles) && sectorOk(j, sectors));
  if (matched.length > 0) return matched.sort(byNewest).slice(0, PREFILTER_CAP);
  return [...jobs].sort(byNewest).slice(0, FALLBACK_CAP);
}
