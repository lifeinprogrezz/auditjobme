// Dataplane assembly — pure, no network, no DB (Track D F3, issue #37).
// One daily build turns the public map data (live jobs + companies + offices)
// into static artifacts every audience derives from:
//   dataplane.json — the app artifact: /roles fetches this instead of querying
//                    Supabase per visitor (the exact three selects it replaces
//                    are pinned in the COLUMN constants below — keep them in
//                    sync with src/hooks/useRolesData.ts, rule + code together)
//   jobs.ndjson    — the feed artifact: one job per line, for GEO/agent
//                    consumers (F2 fact pages derive from this)
// Unit tests: dataplane-lib.test.mjs (node --test, offline).

/** The exact column sets the /roles map reads — the artifact carries these verbatim. */
export const JOBS_COLUMNS =
  "id, company, title, url, location, remote, source, seniority, posted_at, first_seen_at, company_id, extraction, role_family, workplace";
export const COMPANIES_COLUMNS =
  "slug, logo_domain, lat, lng, website, sector, stage, headcount_bucket, hq_city, hq_country, linkedin_url, description, founded_year, uk_sponsor_status";
export const OFFICES_COLUMNS = "company_slug, lat, lng";

export const DATAPLANE_VERSION = 1;

/**
 * Assemble the artifacts from the three row sets. Deterministic: rows are
 * sorted by stable keys so two builds over the same data are byte-identical
 * (diffable, cache-friendly).
 */
export function buildDataplane(jobs, companies, offices, generatedAt) {
  const sortedJobs = [...jobs].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const sortedCompanies = [...companies].sort((a, b) =>
    String(a.slug).localeCompare(String(b.slug)),
  );
  const sortedOffices = [...offices].sort(
    (a, b) =>
      String(a.company_slug).localeCompare(String(b.company_slug)) ||
      a.lat - b.lat ||
      a.lng - b.lng,
  );

  const artifact = {
    version: DATAPLANE_VERSION,
    generated_at: generatedAt,
    counts: {
      jobs: sortedJobs.length,
      companies: sortedCompanies.length,
      offices: sortedOffices.length,
    },
    jobs: sortedJobs,
    companies: sortedCompanies,
    offices: sortedOffices,
  };

  return {
    json: JSON.stringify(artifact),
    ndjson: sortedJobs.map((j) => JSON.stringify(j)).join("\n") + (sortedJobs.length ? "\n" : ""),
    counts: artifact.counts,
  };
}
