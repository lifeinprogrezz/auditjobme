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
 * Fetch the artifact. Returns null on ANY failure (network, non-200, shape) —
 * the caller keeps the live-read path as fallback.
 */
export async function fetchDataplane(supabaseUrl: string): Promise<Dataplane | null> {
  try {
    const res = await fetch(dataplaneUrl(supabaseUrl));
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isDataplane(body) ? body : null;
  } catch {
    return null;
  }
}
