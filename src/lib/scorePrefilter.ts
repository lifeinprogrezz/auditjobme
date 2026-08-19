// Per-user scoring prefilter (issue #114): the deterministic prune that runs
// BEFORE any paid score call. The all-vertical merge grew the live catalog to
// ~8K rows, so an unfiltered CV signup cost ~$19; this narrows the pass to the
// user's chosen targets with a hard cost ceiling. Shared by the backlog worker
// (api/score-backlog.ts — what gets paid for) and useRolesData (what "still
// scoring" means) — the two MUST agree or /roles polls forever.
// Client-import-free (like labels.ts). Pinned by src/test/score-prefilter.test.ts.
// Spec: planning repo docs/specs/2026-08-19-score-backlog-prefilter-design.md.
// The .js extension is load-bearing, not style: api/score-backlog.ts imports this
// module, Vercel compiles that to native ESM, and Node resolves the specifier
// literally. Without it the deployed function dies at import with
// ERR_MODULE_NOT_FOUND while every local gate stays green. Pinned by
// src/test/api-esm-imports.test.ts, which walks the whole api/ import graph.
import { roleMatchesTargets, type Labels } from "./labels.js";

/** Hard per-user slice ceiling (~$3.60 at ~$0.0024/batch-score). A cost dial,
 *  not a scoring judgment — the cap sheds the OLDEST rows, so the slice is
 *  always the freshest N matching roles. */
export const PREFILTER_CAP = 1500;

/** Slice ceiling for a user who picked NO labels at all (~$2.40). Deliberately
 *  NOT the full catalog — pickScoringSlice's full-list fallback is exactly the
 *  $19 failure this module exists to close.
 *
 *  This applies ONLY to the no-labels case. A user whose labels match nothing
 *  gets an EMPTY slice, not a consolation thousand: they told us what they want,
 *  and buying a pile of roles they ruled out would punish precise targeting
 *  (only ~38% of live rows carry a sector, so a role plus sector pair misses
 *  often). "Not scored" copy on those rows points at Settings instead. */
export const FALLBACK_CAP = 1000;

export type PrefilterJob = {
  /** Stable tiebreaker for the ordering below, which cannot rely on dates alone. */
  id: string;
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

/** Role dimension: roleMatchesTargets in labels.ts — the ONE rule (issue #70),
 *  shared with pickScoringSlice so the nightly digest and this paid worker can
 *  never disagree about what a label means. */
function roleOk(j: PrefilterJob, roles: string[]): boolean {
  return roleMatchesTargets(j, roles);
}

/** Sector dimension: OR-within, AND-across (same semantics as
 *  pickScoringSlice and the map filter — a null-sector row does not pass a
 *  sector selection). */
function sectorOk(j: PrefilterJob, sectors: string[]): boolean {
  if (sectors.length === 0) return true;
  return j.sector != null && sectors.includes(j.sector);
}

/** How a role's fit should be presented. Before the prefilter, every unscored
 *  role was genuinely mid-pass; now a role outside the paid slice never scores,
 *  so "scoring…" copy would be a permanent lie. Pinned by score-status.test.ts. */
export type ScoreStatus = "scored" | "scoring" | "not-scored";

/** Which rung of the degradation ladder produced a slice.
 *  targeted  — every label the user picked was honoured.
 *  role-only — their role matched but their sector matched nothing, so the
 *              sector was dropped rather than buying unrelated roles.
 *  newest    — they picked no labels, so we take the freshest slice. */
export type PrefilterTier = "targeted" | "role-only" | "newest";

/** The single decision point for that distinction — every surface that renders a
 *  pending state MUST route through here rather than testing `score == null`. */
export function scoreStatusOf(score: number | null | undefined, eligible: boolean): ScoreStatus {
  if (score != null) return "scored";
  return eligible ? "scoring" : "not-scored";
}

/**
 * The prefilter: label-matching rows, newest-first, capped at PREFILTER_CAP.
 *
 * A user with NO labels gets the newest FALLBACK_CAP rows. A user whose labels
 * match nothing gets NOTHING — see FALLBACK_CAP for why a consolation slice is
 * the wrong answer.
 *
 * The ordering must be TOTAL, not merely newest-first. `first_seen_at` is a
 * statement timestamp, so an entire scrape batch shares one value and ties run
 * into the hundreds. A tie broken by input order would let the worker (reading
 * the database) and the client (reading the dataplane artifact) cut the cap at
 * different rows: the client would then sit waiting on roles the worker never
 * intends to score, and the progress bar would never reach zero. Sorting by id
 * within a tie makes both callers choose the same slice from the same catalog.
 */
export function prefilterWithTier<T extends PrefilterJob>(
  jobs: T[],
  labels: Labels,
): { jobs: T[]; tier: PrefilterTier } {
  const roles = labels.roles ?? [];
  const sectors = labels.sectors ?? [];
  const byNewest = (a: T, b: T) => seenMs(b) - seenMs(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const take = (rows: T[], cap: number) => rows.sort(byNewest).slice(0, cap);

  if (roles.length === 0 && sectors.length === 0) {
    return { jobs: take([...jobs], FALLBACK_CAP), tier: "newest" };
  }

  const targeted = jobs.filter((j) => roleOk(j, roles) && sectorOk(j, sectors));
  if (targeted.length > 0) return { jobs: take(targeted, PREFILTER_CAP), tier: "targeted" };

  // Both dimensions together matched nothing. Rather than buy a thousand roles
  // the user ruled out, or score nothing at all, drop the sector and honour the
  // role they picked. The sector is the dimension that gives way because it is
  // the one our data is worst at: most live rows carry no sector, and the
  // offline chip list offers names the catalog never uses.
  if (roles.length > 0 && sectors.length > 0) {
    const roleOnly = jobs.filter((j) => roleOk(j, roles));
    if (roleOnly.length > 0) return { jobs: take(roleOnly, PREFILTER_CAP), tier: "role-only" };
  }

  // Nothing the user asked for exists in the catalog. An empty slice is the
  // honest answer; the "Not scored" copy on those rows points at Settings.
  return { jobs: [], tier: "targeted" };
}

/** The slice itself, for callers that do not care how it was reached. */
export function prefilterJobs<T extends PrefilterJob>(jobs: T[], labels: Labels): T[] {
  return prefilterWithTier(jobs, labels).jobs;
}

/** Which rung produced the slice — drives copy that must not overclaim. */
export function prefilterTierOf<T extends PrefilterJob>(jobs: T[], labels: Labels): PrefilterTier {
  return prefilterWithTier(jobs, labels).tier;
}
