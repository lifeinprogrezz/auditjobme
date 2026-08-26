// Cached reads behind the /roles data plane (issue #152).
//
// Every read below used to live inside one `useEffect` in useRolesData, keyed on the
// Supabase `user` OBJECT and holding its result in component state. Two consequences
// shipped: navigating to a route remounted the hook and re-fetched the whole set, and
// supabase-js hands out a NEW user object on every token refresh (tab focus), which
// re-ran the same effect again. Settings showed "Loading your profile…" both times.
//
// The fetchers are unchanged; what changed is where the result lives. Each read is a
// TanStack Query with a user-scoped key, so a route change or a tab focus reuses the
// cached rows and re-validates in the background instead of blanking the page. Keys are
// scoped by user id, so one person's rows can never be read under another's key.
//
// A FAILED read must throw, never resolve empty — see `assertOk` below.
//
// Rule + code move together: the keys, the stale windows and the throw-on-error rule
// are pinned by src/test/roles-data-cache.test.tsx.

import { supabase } from "@/integrations/supabase/client";
import { fetchDataplane, type DataplaneCompany, type DataplaneOffice } from "@/lib/dataplane";
import { fetchAllPages } from "@/lib/pagedSelect";
import { RUBRIC_VERSION } from "@/lib/score";
import type { RoleExtraction } from "@/lib/roles";

/** A live job row as the map reads it — the dataplane artifact's column set. */
export type JobsRow = {
  id: string;
  company: string;
  title: string;
  url: string;
  location: string | null;
  remote: boolean;
  source: string | null;
  seniority: string | null;
  posted_at: string | null;
  /** jobs.first_seen_at — the Freshness facet's primary key (issue #73 slice 3);
   *  NOT NULL in the DB, optional here only for a pre-#73 dataplane artifact. */
  first_seen_at?: string | null;
  company_id: string | null;
  extraction: RoleExtraction | null;
  role_family: string | null;
  workplace: string | null;
  /** jobs.has_jd (#130): optional only for an artifact built before the column. */
  has_jd?: boolean | null;
};

export type ScoreRow = { job_id: string; score: number | null; signals: unknown };
export type ApplicationRow = { job_id: string; status: string | null };
export type AppliedJobRow = { id: string; company: string; company_id: string | null };
/** The applications slice: the rows themselves plus the applied roles' OWN job rows,
 *  read WITHOUT the is_live filter so the in-flight company collapse survives a
 *  posting closing mid-conversation. */
export type ApplicationsData = { applications: ApplicationRow[]; jobRows: AppliedJobRow[] };
/** Saved / dismissed: the ids the user holds, plus those roles' own job rows (again
 *  liveness-independent, so an expired-but-saved role still has display data). */
export type RoleSetData = { ids: string[]; rows: JobsRow[] };
export type ConnectionRow = {
  full_name: string;
  company: string;
  company_key: string;
  position: string | null;
  linkedin_url: string | null;
  created_at: string;
};
export type ProfileRow = {
  target_seniority: string | null;
  target_cities: string[] | null;
  open_to_remote: boolean | null;
  citizenship: string | null;
  eu_work_authorized: boolean | null;
  languages: string[] | null;
  cv_text: string | null;
  target_roles: string[] | null;
  target_sectors: string[] | null;
  updated_at: string | null;
};
/** The three PUBLIC reads (live jobs + companies + offices), served by one artifact. */
export type PublicPool = {
  jobs: JobsRow[];
  companies: DataplaneCompany[];
  offices: DataplaneOffice[];
};

const PAGE = 1000; // PostgREST caps un-ranged selects at 1000 rows — page past it.

/**
 * Every function in this file is a TanStack `queryFn`, and a queryFn has exactly two
 * honest outcomes: the complete data, or a throw.
 *
 * Resolving with an empty result on a PostgREST or network error is the third, dishonest
 * one, and it is destructive here because these queries re-validate on their own: on tab
 * focus, on mount past the stale window, and on reconnect. A person wakes the laptop,
 * focus fires before the wifi is back, one read fails — and if that failure resolves
 * empty, TanStack records a SUCCESSFUL refetch and overwrites the last good rows. The
 * profile nulls, so `hasCv` flips false and the CV modal opens for a user who HAS a CV
 * and Settings offers to save empty targets over the stored ones; applications and saved
 * empty, so applied roles resurface in the queue; scores blank, so the map goes back to
 * "Scoring…". Throwing keeps the cached rows exactly as they were, marks the query
 * `isError`, and retries.
 *
 * A legitimately MISSING row is not an error and must not throw: `maybeSingle()` returns
 * `{ data: null, error: null }` for a user with no profile yet, and an empty `select`
 * returns `{ data: [], error: null }`. Only `error` means the read failed.
 */
function assertOk(label: string, error: { message: string } | null | undefined): void {
  if (error) throw new Error(`[rolesQueries] ${label} read failed: ${error.message}`);
}

/** Columns the map needs off a job row, live-query fallback and by-id reads alike. */
const JOB_COLUMNS =
  "id, company, title, url, location, remote, source, seniority, posted_at, first_seen_at, company_id, extraction, role_family, workplace";

/** The public pool changes once a day (the artifact is rebuilt after the scrape), so
 *  ten minutes of freshness is generous and still cheap. */
export const PUBLIC_POOL_STALE_MS = 10 * 60_000;
/** Own-row reads: a minute is long enough that a route change or a tab focus is free,
 *  short enough that a change made in another tab shows up on the next visit. */
export const USER_STALE_MS = 60_000;
/** Keep a cached read reachable well past the stale window, so leaving Settings for a
 *  while and coming back still opens instantly. */
const GC_MS = 60 * 60_000;

/** One place that decides what a cache key looks like. Scoped by user id — never by
 *  the user object, which is a different value on every token refresh. */
export const rolesKeys = {
  publicPool: () => ["roles", "public-pool"] as const,
  scores: (userId: string) => ["roles", "scores", userId] as const,
  applications: (userId: string) => ["roles", "applications", userId] as const,
  saved: (userId: string) => ["roles", "saved", userId] as const,
  dismissed: (userId: string) => ["roles", "dismissed", userId] as const,
  connections: (userId: string) => ["roles", "connections", userId] as const,
  profile: (userId: string) => ["roles", "profile", userId] as const,
};

/**
 * F3 (issue #37): the three public reads are served by ONE static artifact, rebuilt
 * daily after the scrape — zero database reads per anonymous visitor. The live queries
 * stay as FALLBACK for a missing or unreachable artifact (deploy-order safe; the map
 * never breaks on the dataplane).
 */
export async function fetchPublicPool(): Promise<PublicPool> {
  const plane = await fetchDataplane(import.meta.env.VITE_SUPABASE_URL as string);
  if (plane) {
    return {
      jobs: plane.jobs as unknown as JobsRow[],
      companies: plane.companies,
      offices: plane.offices,
    };
  }
  // Jobs are public postings (anon SELECT on is_live rows, migration 20260705121000)
  // — fetched signed-in or not. Everything personalized lives in the reads below.
  let jobs: JobsRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("jobs")
      .select(`${JOB_COLUMNS}, has_jd`)
      .eq("is_live", true)
      .range(from, from + PAGE - 1);
    assertOk("jobs:fallback", error);
    const rows = (data ?? []) as unknown as JobsRow[];
    jobs = jobs.concat(rows);
    if (rows.length < PAGE) break;
  }
  // Paged: 598 companies today, but the catalogue grows and PostgREST would silently
  // return the first 1000. A company missing from this list loses its logo, sector,
  // headcount and map position — quietly, on an arbitrary subset.
  const companies = await fetchAllPages<DataplaneCompany>(
    () =>
      supabase
        .from("companies")
        .select(
          "slug, logo_domain, lat, lng, website, sector, stage, headcount_bucket, hq_city, hq_country, linkedin_url, description, founded_year, uk_sponsor_status",
        ),
    { label: "companies:dataplane", strict: true },
  );
  const { data: offs, error: offErr } = await supabase
    .from("company_offices")
    .select("company_slug, lat, lng");
  assertOk("company_offices", offErr);
  return { jobs, companies, offices: (offs ?? []) as DataplaneOffice[] };
}

/**
 * Every landed score for this user, paged. PostgREST caps an un-ranged select at 1000
 * rows silently: un-paged, a user with more scores than that saw most of their roles
 * as unscored forever (see lib/pagedSelect.ts).
 */
export async function fetchScores(userId: string): Promise<ScoreRow[]> {
  return fetchAllPages<ScoreRow>(
    () =>
      supabase
        .from("scores")
        .select("job_id, score, signals")
        .eq("user_id", userId)
        .eq("rubric_version", RUBRIC_VERSION),
    { label: "scores:read", strict: true },
  );
}

export async function fetchApplications(userId: string): Promise<ApplicationsData> {
  const { data: appsData, error } = await supabase
    .from("applications")
    .select("job_id, status")
    .eq("user_id", userId);
  assertOk("applications", error);
  const applications: ApplicationRow[] = (appsData ?? []).map((a) => ({
    job_id: a.job_id,
    status: a.status ?? null,
  }));
  const ids = applications.map((a) => a.job_id);
  if (ids.length === 0) return { applications, jobRows: [] };
  // Resolve those applications to their companies from their OWN rows, not from the
  // live pool: an application whose posting has since closed must still collapse its
  // company while the conversation is open.
  const { data: jobRows, error: jobsErr } = await supabase
    .from("jobs")
    .select("id, company, company_id")
    .in("id", ids);
  assertOk("applications:jobs", jobsErr);
  return { applications, jobRows: (jobRows ?? []) as AppliedJobRow[] };
}

/** Shared shape for saved_jobs / dismissed_jobs: own-row ids, then those roles' job
 *  rows WITHOUT the is_live filter so an expired role keeps its display data. */
async function fetchRoleSet(userId: string, table: "saved_jobs" | "dismissed_jobs"): Promise<RoleSetData> {
  const { data, error } = await supabase.from(table).select("job_id").eq("user_id", userId);
  assertOk(table, error);
  const ids = (data ?? []).map((r) => r.job_id);
  if (ids.length === 0) return { ids, rows: [] };
  const { data: rows, error: jobsErr } = await supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .in("id", ids);
  assertOk(`${table}:jobs`, jobsErr);
  return { ids, rows: (rows ?? []) as unknown as JobsRow[] };
}

export const fetchSaved = (userId: string) => fetchRoleSet(userId, "saved_jobs");
export const fetchDismissed = (userId: string) => fetchRoleSet(userId, "dismissed_jobs");

/**
 * Warm contacts (issue #41): the user's whole connections upload, paged past
 * PostgREST's row cap (a LinkedIn export routinely runs to a few thousand rows).
 *
 * A failed page throws (see `assertOk`). It used to swallow the error and return the
 * rows collected so far, which cached a truncated upload as a successful read and left
 * the map missing warm markers the person had uploaded. The caller still degrades to no
 * markers while the query is in error — `connectionsQ.data ?? []` — it just no longer
 * writes that emptiness over the good rows.
 */
export async function fetchConnections(userId: string): Promise<ConnectionRow[]> {
  let rows: ConnectionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("connections")
      .select("full_name, company, company_key, position, linkedin_url, created_at")
      .eq("user_id", userId)
      .range(from, from + PAGE - 1);
    assertOk("connections", error);
    const page = (data ?? []) as ConnectionRow[];
    rows = rows.concat(page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/**
 * The profile row, or null when the user has none yet. Never undefined: a query
 * function that returns undefined is an error in TanStack Query.
 *
 * The null is reserved for the one thing it can honestly mean — NO ROW. `maybeSingle()`
 * reports that as `{ data: null, error: null }`, so `error` is the only signal that the
 * read itself failed, and a failed read throws. This is the load-bearing case: a null
 * profile flips `hasCv` false, which opens the CV modal on /roles for someone who has a
 * CV and makes Settings render "No CV on file" with empty chips over stored targets.
 */
export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "target_seniority, target_cities, open_to_remote, citizenship, eu_work_authorized, languages, cv_text, target_roles, target_sectors, updated_at",
    )
    .eq("id", userId)
    .maybeSingle();
  assertOk("profiles", error);
  return (data as ProfileRow | null) ?? null;
}

/** Query options for the public pool — the one read an anonymous visitor also makes. */
export function publicPoolQuery() {
  return {
    queryKey: rolesKeys.publicPool(),
    queryFn: fetchPublicPool,
    staleTime: PUBLIC_POOL_STALE_MS,
    gcTime: GC_MS,
  };
}

/** Options for one own-row read. `userId` is null while signed out, when the caller
 *  disables the query; the key still carries a stable placeholder so no read of a
 *  previous user's cache can ever resolve under it. */
function userQuery<T>(key: readonly unknown[], run: (userId: string) => Promise<T>, userId: string | null) {
  return {
    queryKey: key,
    queryFn: () => run(userId as string),
    staleTime: USER_STALE_MS,
    gcTime: GC_MS,
  };
}

const ANON = "anonymous";

export const scoresQuery = (userId: string | null) =>
  userQuery(rolesKeys.scores(userId ?? ANON), fetchScores, userId);
export const applicationsQuery = (userId: string | null) =>
  userQuery(rolesKeys.applications(userId ?? ANON), fetchApplications, userId);
export const savedQuery = (userId: string | null) =>
  userQuery(rolesKeys.saved(userId ?? ANON), fetchSaved, userId);
export const dismissedQuery = (userId: string | null) =>
  userQuery(rolesKeys.dismissed(userId ?? ANON), fetchDismissed, userId);
export const connectionsQuery = (userId: string | null) =>
  userQuery(rolesKeys.connections(userId ?? ANON), fetchConnections, userId);
export const profileQuery = (userId: string | null) =>
  userQuery(rolesKeys.profile(userId ?? ANON), fetchProfile, userId);
