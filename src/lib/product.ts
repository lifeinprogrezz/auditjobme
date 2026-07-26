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

/** The identity we collapse a company on (issue #73 slices 1+2). The linked
 *  companies-dimension slug wins; otherwise the display name, trimmed and
 *  case-folded so a scraped casing variant can't split one company into two. */
export function companyKey(job: Pick<RoleJob, "company" | "company_id">): string {
  return job.company_id ?? job.company.trim().toLowerCase();
}

/** One row of the action queue: the company's best role plus the rest of that
 *  company's actionable roles, best-first. `more` drives the "+N more from {company}"
 *  affordance and is empty for a single-role company. */
export interface QueueEntry {
  job: RoleJob;
  more: RoleJob[];
}

/** The Today "action queue": one row per company, ranked best-first, plus the
 *  headline counts ("N scored, M worth applying") that carry the emotional payoff. */
export interface ActionQueue {
  total: number;
  scored: number;
  worthApplying: number;
  queue: QueueEntry[];
}

export interface ActionQueueOptions {
  /** Roles the user dismissed as not interesting (issue #73 slice 4) — they leave
   *  the queue entirely, and the "+N more" lists with it. */
  dismissedIds?: ReadonlySet<string>;
  /** companyKey() of every company with an IN-FLIGHT application (issue #73 slice
   *  2). The whole company collapses out of the queue while one is open; a
   *  rejected or closed company is absent from this set, so it resurfaces on a NEW
   *  role. Build it with inFlightCompanyKeys(). */
  inFlightCompanies?: ReadonlySet<string>;
  /** Cap the number of ENTRIES (companies), not roles. Infinity by default. */
  cap?: number;
}

/**
 * The Today action queue: every SCORED role the user hasn't applied to, dismissed,
 * or already has a live conversation about, ranked best-first and COLLAPSED TO ONE
 * ROW PER COMPANY (issue #73 slice 1 — three roles from one company used to be able
 * to own the whole top 10). The dropped siblings ride along in `more`, so the row
 * offers them instead of hiding them. Applied roles drop out (they live in the
 * tracker now). Pure.
 *
 * The headline counts stay POOL counts (every scored role, every actionable role at
 * or above the bar): they answer "how much did we look at for you", which the
 * company collapse must not quietly shrink.
 *
 * UNCAPPED by default (Rober 7-25): "More matches" must scroll as deep as the scored
 * pool goes — the old cap=40 silently ended the list at 30 tail rows. DOM cost is the
 * renderer's problem (Today reveals incrementally), not the data layer's. Callers can
 * still pass a finite cap.
 */
export function buildActionQueue(
  jobs: RoleJob[],
  appliedIds: ReadonlySet<string>,
  opts: ActionQueueOptions = {},
): ActionQueue {
  const { dismissedIds, inFlightCompanies, cap = Infinity } = opts;
  const actionable = jobs
    .filter(
      (j) =>
        j.score != null &&
        !appliedIds.has(j.id) &&
        !(dismissedIds?.has(j.id) ?? false) &&
        !(inFlightCompanies?.has(companyKey(j)) ?? false),
    )
    .sort(byScore);
  const scored = jobs.filter((j) => j.score != null).length;
  const worthApplying = actionable.filter((j) => (j.score as number) >= WORTH_APPLYING_MIN).length;

  // Cap-1 per company: the first role a company reaches (the list is already
  // best-first) becomes its row; every later one becomes a "+N more" sibling.
  const byCompany = new Map<string, QueueEntry>();
  const order: string[] = [];
  for (const j of actionable) {
    const key = companyKey(j);
    const entry = byCompany.get(key);
    if (entry) entry.more.push(j);
    else {
      byCompany.set(key, { job: j, more: [] });
      order.push(key);
    }
  }
  const entries = order.map((k) => byCompany.get(k) as QueueEntry);
  return {
    total: jobs.length,
    scored,
    worthApplying,
    queue: Number.isFinite(cap) ? entries.slice(0, cap) : entries,
  };
}

/**
 * companyKey() of every company the user has a LIVE conversation with (issue #73
 * slice 2). `applications` carries job_id + status; each resolves to its company
 * through the job pool. A status we don't recognise, or a job_id we can't resolve,
 * contributes nothing — a company's roles are never hidden on a guess.
 */
export function inFlightCompanyKeys(
  jobs: Pick<RoleJob, "id" | "company" | "company_id">[],
  applications: { job_id: string; status?: string | null }[],
  isInFlight: (status: string | null | undefined) => boolean,
): Set<string> {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const keys = new Set<string>();
  for (const a of applications) {
    if (!isInFlight(a.status)) continue;
    const job = byId.get(a.job_id);
    if (job) keys.add(companyKey(job));
  }
  return keys;
}

/** One persisted nightly match row, as /today reads it back from daily_matches. */
export interface DailyMatchRow {
  job_url: string;
  batch_date: string;
  rank?: number | null;
  seen_at?: string | null;
  /** The score the EMAIL quoted. Only reused when its rubric is still current. */
  score?: number | null;
  reason?: string | null;
  rubric_version?: string | null;
}

/** The most recent nightly batch, rank-ordered (issue #72 slice 1). daily_matches
 *  holds every night the user has been matched; the "New" section shows the LATEST
 *  batch only. Returns an empty batch (null date) when there is nothing yet. */
export function selectLatestBatch<T extends DailyMatchRow>(
  rows: T[],
): { batchDate: string | null; rows: T[] } {
  if (rows.length === 0) return { batchDate: null, rows: [] };
  const batchDate = rows.reduce(
    (max, r) => (r.batch_date > max ? r.batch_date : max),
    rows[0].batch_date,
  );
  const batch = rows
    .filter((r) => r.batch_date === batchDate)
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
  return { batchDate, rows: batch };
}

/**
 * Heading for the /today "New" section (issue #72 slice 1). The nightly worker only
 * writes a batch on a night that found new roles, so the latest batch is often from
 * an earlier day, and calling that "New today" would be a small lie. Today's batch
 * says "New today"; anything older is dated honestly.
 */
export function newSectionHeading(batchDate: string | null, now: Date = new Date()): string {
  if (!batchDate) return "New";
  const today = now.toISOString().slice(0, 10);
  if (batchDate === today) return "New today";
  const d = new Date(`${batchDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "New";
  return `New on ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
}

/**
 * Resolve a nightly batch to the live role rows it points at, in rank order
 * (daily_matches stores only job_url). Roles already applied to or dismissed drop
 * out — the section is a to-do list, not an archive. A URL with no matching live
 * job is skipped rather than rendered as a stub.
 *
 * The nightly worker scores into daily_matches, NOT into `scores`, so a role matched
 * last night can reach /today before the in-app backlog pass has scored it. When that
 * happens we show the number the EMAIL quoted rather than an empty chip — the whole
 * point of issue #72 is that the two agree. Guarded on the rubric: a batch scored
 * under a superseded rubric is NOT resurfaced as a current score (pass
 * `rubricVersion` to enable the overlay at all).
 */
export function resolveBatchJobs(
  batch: DailyMatchRow[],
  jobs: RoleJob[],
  opts: {
    appliedIds?: ReadonlySet<string>;
    dismissedIds?: ReadonlySet<string>;
    rubricVersion?: string;
  } = {},
): RoleJob[] {
  const byUrl = new Map(jobs.map((j) => [j.url, j]));
  const out: RoleJob[] = [];
  const seen = new Set<string>();
  for (const row of batch) {
    const job = byUrl.get(row.job_url);
    if (!job || seen.has(job.id)) continue;
    if (opts.appliedIds?.has(job.id) || opts.dismissedIds?.has(job.id)) continue;
    seen.add(job.id);
    const canOverlay =
      job.score == null &&
      row.score != null &&
      opts.rubricVersion != null &&
      row.rubric_version === opts.rubricVersion;
    out.push(canOverlay ? { ...job, score: Number(row.score), reason: row.reason ?? job.reason } : job);
  }
  return out;
}
