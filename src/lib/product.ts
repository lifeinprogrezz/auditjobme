// Pure helpers for the routed product surfaces (issue #42): the Today action-queue
// and the honest coverage banner. No supabase/DOM imports — pinned by product.test.ts.
// Rule + code move together: change the shape here and its test follows.
import { byScore, type RoleJob } from "@/lib/roles";

/** Honest coverage of the scanned pool, derived ONLY from data we hold — never a
 *  fabricated denominator. Companies are de-duped on company_id (falling back to the
 *  display name); sources are the distinct scrape origins that produced live roles. */
export interface Coverage {
  roles: number;
  companies: number;
  sources: number;
}
export function coverageSummary(
  jobs: Pick<RoleJob, "company" | "company_id" | "source">[],
): Coverage {
  const companies = new Set<string>();
  const sources = new Set<string>();
  for (const j of jobs) {
    companies.add(j.company_id ?? j.company);
    if (j.source && j.source.trim()) sources.add(j.source.trim());
  }
  return { roles: jobs.length, companies: companies.size, sources: sources.size };
}

/** A role is "worth applying" when it lands in the great bucket (≥4.0), matching the
 *  digest's own great-fit threshold. Kept as a named constant so the Today count and
 *  any future badge never drift apart. */
export const WORTH_APPLYING_MIN = 4;

/** The Today "action queue": every SCORED role the user hasn't applied to yet, ranked
 *  best-first, plus the headline counts ("N scored, M worth applying") that carry the
 *  emotional payoff. Applied roles drop out (they live in the tracker now). Pure. */
export interface ActionQueue {
  total: number;
  scored: number;
  worthApplying: number;
  queue: RoleJob[];
}
export function buildActionQueue(
  jobs: RoleJob[],
  appliedIds: ReadonlySet<string>,
  cap = 40,
): ActionQueue {
  const actionable = jobs
    .filter((j) => j.score != null && !appliedIds.has(j.id))
    .sort(byScore);
  const scored = jobs.filter((j) => j.score != null).length;
  const worthApplying = actionable.filter((j) => (j.score as number) >= WORTH_APPLYING_MIN).length;
  return { total: jobs.length, scored, worthApplying, queue: actionable.slice(0, cap) };
}
