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
 *
 * CALLER CONTRACT: `jobs` must be LIVENESS-INDEPENDENT — it has to contain the
 * applications' own job rows, not just the live pool. Postings close mid-interview
 * (a third of the pool is is_live=false at any time) and career-ops' appliedCos does
 * not care; hand this only live rows and a company quietly stops collapsing exactly
 * when the conversation is hottest. useRolesData satisfies this by fetching the
 * applied rows by id, no is_live filter (RLS: 20260726094000).
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
 * The UTC calendar day a "top matches" set is frozen for, e.g. "2026-08-27". The
 * freeze and the rollover both key on this, never the browser's local day — a
 * traveller crossing time zones must not get two fresh sets, or none, on the same
 * server night.
 */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** One user's frozen "top matches" set, as persisted in `daily_top_sets` (or its
 *  localStorage fallback) — job ids only, in the order they were frozen. */
export interface DailyTopSetSnapshot {
  day: string;
  jobIds: string[];
}

/** One row of the frozen daily top ten, resolved back to its job data. `done` never
 *  removes the row — the slot stays visible and simply marks itself finished. */
export interface DailyTopEntry {
  job: RoleJob;
  done: boolean;
}

export interface DailyTopTen {
  day: string;
  /** The frozen ids for this day — the source of truth for "N of 10", independent
   *  of whether every id still resolves to a job row. */
  jobIds: string[];
  /** Resolved rows, in frozen order. An id with no matching job (a role dropped out
   *  of the pool entirely) is skipped rather than rendered as a stub. */
  entries: DailyTopEntry[];
  doneCount: number;
  total: number;
  /** True when THIS call produced a brand-new freeze (no snapshot existed for
   *  `todayKey`) — the caller's cue to persist `jobIds` as the day's snapshot. */
  isNew: boolean;
}

/**
 * LOCKED decision 2 (spec 2026-08-26-stranger-run-feedback-answers.md, item C1):
 * "Your top matches" is a fixed daily set of 10, not a live ranking. The first time a
 * user's Today render sees no snapshot for `todayKey`, the current best-ranked ten
 * (`queueTop`, already company-collapsed and score-sorted by buildActionQueue) freeze
 * as that day's set. Every later call with a snapshot for the SAME day ignores
 * `queueTop` entirely and replays the frozen ids in their frozen order — applying or
 * dismissing a role never pulls a new one in, it only flips that slot's `done` flag,
 * because `appliedIds`/`dismissedIds` are read fresh every call. A snapshot from an
 * earlier day is stale: the set freezes again for `todayKey`, same as having none.
 *
 * `jobs` is the lookup pool for resolving frozen ids back to job data — pass the full
 * live pool plus any liveness-independent lists the caller already has (e.g.
 * dismissedJobs), so a role that applying/dismissing removed from the live queue can
 * still render as a done row instead of vanishing. Pure: same inputs, same output.
 */
export function dailyTopTen(
  queueTop: QueueEntry[],
  jobs: RoleJob[],
  todayKey: string,
  snapshot: DailyTopSetSnapshot | null,
  appliedIds: ReadonlySet<string>,
  dismissedIds: ReadonlySet<string>,
): DailyTopTen {
  const isFresh = snapshot != null && snapshot.day === todayKey;
  const jobIds = isFresh ? (snapshot as DailyTopSetSnapshot).jobIds : queueTop.map((e) => e.job.id);

  const byId = new Map(jobs.map((j) => [j.id, j]));
  const entries: DailyTopEntry[] = [];
  let doneCount = 0;
  for (const id of jobIds) {
    const job = byId.get(id);
    // A frozen id that no longer resolves to any job row (dropped from the pool
    // entirely — went is_live=false, or its posting died) can never be applied to
    // or dismissed, so it can never flip `done` on its own. Count it done the
    // moment it stops resolving, or completion is unreachable (issue #155
    // fix-round-2 blocker 4): the header sticks at "9 of 10" forever with every
    // other slot struck through.
    const done = !job || appliedIds.has(id) || dismissedIds.has(id);
    if (done) doneCount++;
    if (job) entries.push({ job, done });
  }

  return { day: todayKey, jobIds, entries, doneCount, total: jobIds.length, isNew: !isFresh };
}

/**
 * Whether /today may freeze today's top ten yet (issue #155 fix-round-1, blockers 1 +
 * 3). The candidate ten (`top` on /today) is built from applied/saved/dismissed/
 * inFlightCompanies/newIds, which resolve on separate own-row reads (applicationsQ/
 * savedQ/dismissedQ, useDailyMatches) that useDailyTopSet's own `loading` knows
 * nothing about — `profileChecked` covers the first four (useRolesData.ts:764),
 * `!loading` covers the live pool+scores, and `!batchLoading` covers newIds' own
 * source. Freezing before all three land risks locking an already-applied/dismissed/
 * saved/tonight's-batch role into the day's row, which cannot self-heal (no
 * UPDATE/DELETE policy on daily_top_sets). `!scoring || candidateCount >= 10`
 * additionally holds off a freeze during a scoring drain until either scoring
 * finishes or the ten is actually full, so the drain's first 1-3 scored roles don't
 * freeze as the whole day's set. Pure: same inputs, same output.
 */
export function dailyTopSetReady(
  profileChecked: boolean,
  loading: boolean,
  batchLoading: boolean,
  scoring: boolean,
  candidateCount: number,
): boolean {
  return profileChecked && !loading && !batchLoading && (!scoring || candidateCount >= 10);
}

/**
 * Which saved roles the Saved section should render: ALL of them.
 *
 * This REVERSES issue #155 fix-round-1 blocker 2, deliberately and at Rober's
 * instruction (walking the product, 2026-08-28). That rule dropped a saved role
 * from Saved whenever it also sat in the frozen top ten, so the page never showed
 * one role twice. The cost only appears the next day: you save something out of
 * today's ten, go to Saved to check it is there, and it is not — the one place
 * that names your saved roles is the one place it is missing. Tomorrow the ten
 * re-ranks, it drops out, and the thing you deliberately kept looks lost.
 *
 * Showing it in both places is now the intent, not a bug: the top ten says what is
 * worth doing today, Saved says what you chose to keep, and a role can honestly be
 * both. The frozen-set filter still applies to New (visibleNewJobs), where the
 * duplicate is an accident of timing rather than a thing the user asked for.
 *
 * Kept as a function, rather than dropping the call, so the decision has a place to
 * live and a test to hold it. Pure: same inputs, same output.
 */
export function visibleSavedJobs(savedJobs: RoleJob[]): RoleJob[] {
  return savedJobs;
}

/**
 * Which of tonight's batch the New section should render (issue #155 fix-round-2
 * blocker 3). The nightly cron lands at 06:00 UTC; a visit between 00:00 and 06:00
 * UTC can freeze today's top ten from roles that are already scored and in the pool
 * but not yet in `daily_matches` — `queue`'s own exclusion of "new" only knows about
 * YESTERDAY's batch at that hour. Once the 06:00 batch lands, resolveBatchJobs puts
 * those same roles in New while the earlier freeze already holds them, so a role
 * renders twice for the rest of the day. New drops anything already frozen. Saved
 * deliberately does NOT — see visibleSavedJobs. Pure: same inputs, same output.
 */
export function visibleNewJobs(newJobs: RoleJob[], frozenIds: ReadonlySet<string>): RoleJob[] {
  return newJobs.filter((j) => !frozenIds.has(j.id));
}

/** "N of 10 done today" — the Today header line (issue #155). Uses the frozen set's
 *  own size rather than a hardcoded 10, so a thin day (fewer than 10 scored roles)
 *  still reads honestly. */
export function dailyTopTenHeaderLine(doneCount: number, total: number): string {
  return `${doneCount} of ${total} done today`;
}

/** The warm completion line once every slot in the frozen set is done. Null while
 *  there is still something left, or when there was nothing to freeze at all. */
export function dailyTopTenCompleteLine(doneCount: number, total: number): string | null {
  if (total === 0 || doneCount < total) return null;
  return "That is today's ten. New ones tomorrow morning.";
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
