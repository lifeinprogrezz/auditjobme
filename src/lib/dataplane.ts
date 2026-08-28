// Static-dataplane consumption (Track D F3, issue #37). The /roles map's three
// public reads (live jobs + companies + company_offices) are served by ONE
// pre-built artifact, generated daily by scripts/build-dataplane.mjs after the
// scrape and uploaded to the public `dataplane` Storage bucket. Zero DB reads
// per anonymous visitor; the caller falls back to live queries when the
// artifact is missing or malformed (deploy-order safe, map never breaks).
// Column sets are pinned in scripts/dataplane-lib.mjs — rule + code together.

export interface DataplaneJob {
  id: string;
  company: string;
  title: string;
  url: string;
  location: string | null;
  remote: boolean;
  source: string | null;
  seniority: string | null;
  posted_at: string | null;
  /** Optional: an artifact built before issue #73 predates the column, and the
   *  freshness facet falls back to posted_at rather than breaking (roleSeenMs). */
  first_seen_at?: string | null;
  company_id: string | null;
  extraction: Record<string, unknown> | null;
  role_family: string | null;
  workplace: string | null;
  /** jobs.has_jd (#130): optional, an artifact built before the column omits it. */
  has_jd?: boolean | null;
}

export interface DataplaneCompany {
  slug: string;
  logo_domain: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  sector: string | null;
  stage: string | null;
  headcount_bucket: string | null;
  hq_city: string | null;
  hq_country: string | null;
  linkedin_url: string | null;
  description: string | null;
  founded_year: number | null;
  uk_sponsor_status: string | null;
}

export interface DataplaneOffice {
  company_slug: string;
  /** The office's own city — used to check it sits in the country a role names
   *  before that office stands in for a country-only location (geo.fallbackCity).
   *  Optional: an artifact published before 2026-08-28 does not carry it, and the
   *  fallback simply finds no candidate rather than throwing. */
  city?: string | null;
  lat: number;
  lng: number;
}

export interface Dataplane {
  version: number;
  generated_at: string;
  counts: { jobs: number; companies: number; offices: number };
  jobs: DataplaneJob[];
  companies: DataplaneCompany[];
  offices: DataplaneOffice[];
}

export function dataplaneUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/dataplane/dataplane.json`;
}

/**
 * Does this artifact carry `jobs.has_jd` (issue #149, item A8)?
 *
 * The readability gate fails CLOSED (scorePrefilter.ts hasReadableJd), so an
 * artifact built before the column joined JOBS_COLUMNS would make every role look
 * unreadable to the app: no scores applied, nothing counted, a blank-ish map. An
 * artifact built before a column is not stale data, it is the WRONG COLUMN SET.
 *
 * Deliberately NOT part of isDataplane. That guard answers "can renderSite eat
 * this", and the GEO prerender in vite.config.ts asks it at build time; a missing
 * scoring column is none of its business, and failing it there would drop every
 * city page over something the city pages never read.
 *
 * This is the runtime half of the rule in docs/ARCHITECTURE.md: a column added to
 * JOBS_COLUMNS needs an artifact rebuild (`npm run dataplane:build`). Until that
 * runs, the app degrades to the live queries it kept as a fallback.
 */
export function artifactCarriesHasJd(jobs: unknown[]): boolean {
  const first = jobs[0];
  if (!first || typeof first !== "object") return true; // no rows, nothing to disagree about
  return "has_jd" in (first as Record<string, unknown>);
}

/** Structural check — enough to trust the artifact over live reads. */
export function isDataplane(x: unknown): x is Dataplane {
  if (!x || typeof x !== "object") return false;
  const d = x as Partial<Dataplane>;
  return (
    typeof d.version === "number" &&
    typeof d.generated_at === "string" &&
    Array.isArray(d.jobs) &&
    Array.isArray(d.companies) &&
    Array.isArray(d.offices)
  );
}

/**
 * Fetch the artifact for the APP (the /roles map and everything it feeds).
 * Returns null on ANY failure (network, non-200, shape, or a column set older
 * than the app's rules) — the caller keeps the live-read path as fallback.
 */
export async function fetchDataplane(supabaseUrl: string): Promise<Dataplane | null> {
  try {
    const res = await fetch(dataplaneUrl(supabaseUrl));
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!isDataplane(body)) return null;
    // #149: an artifact without has_jd would blank every score. Read live instead
    // until the rebuild lands. See artifactCarriesHasJd.
    return artifactCarriesHasJd(body.jobs) ? body : null;
  } catch {
    return null;
  }
}
