// Publish the static dataplane (Track D F3, issue #37) — the "one build, two
// audiences" step. Runs in the scrape workflow after the pool is refreshed:
// reads the public map data ONCE with the service role, assembles the
// artifacts (dataplane-lib.mjs), and uploads them to the public `dataplane`
// Storage bucket. The /roles map fetches the artifact instead of querying the
// DB per visitor; GEO feeds (F2) derive from the same artifacts.
//
// Public URLs (CDN-fronted, eu-central-1):
//   {SUPABASE_URL}/storage/v1/object/public/dataplane/dataplane.json
//   {SUPABASE_URL}/storage/v1/object/public/dataplane/jobs.ndjson
//
// Env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (same contract as scrape.mjs).
// Idempotent: creates the bucket if missing, upserts the objects.
import { createClient } from "@supabase/supabase-js";
import {
  buildDataplane,
  JOBS_COLUMNS,
  COMPANIES_COLUMNS,
  OFFICES_COLUMNS,
} from "./dataplane-lib.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "dataplane";
const PAGE = 1000;
// 15 min CDN cache: artifacts refresh daily at ~05:30 UTC, so staleness is
// bounded while manual re-runs still propagate within minutes.
const CACHE_SECONDS = "900";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("dataplane: no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY set → nothing to do.");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY);

async function readAll(table, columns, filter) {
  let rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    rows = rows.concat(data ?? []);
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const [jobs, companies, offices] = await Promise.all([
    readAll("jobs", JOBS_COLUMNS, (q) => q.eq("is_live", true)),
    readAll("companies", COMPANIES_COLUMNS),
    readAll("company_offices", OFFICES_COLUMNS),
  ]);

  const { json, ndjson, counts } = buildDataplane(
    jobs,
    companies,
    offices,
    new Date().toISOString(),
  );

  // Ensure the public bucket exists (idempotent — "already exists" is fine).
  const { error: bucketErr } = await db.storage.createBucket(BUCKET, { public: true });
  if (bucketErr && !/already exists/i.test(bucketErr.message)) {
    throw new Error(`bucket create failed: ${bucketErr.message}`);
  }

  const uploads = [
    ["dataplane.json", json, "application/json"],
    ["jobs.ndjson", ndjson, "application/x-ndjson"],
  ];
  for (const [name, body, contentType] of uploads) {
    const { error } = await db.storage.from(BUCKET).upload(name, body, {
      contentType,
      cacheControl: CACHE_SECONDS,
      upsert: true,
    });
    if (error) throw new Error(`upload ${name} failed: ${error.message}`);
    console.log(
      `dataplane: ${name} → ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${name} (${Buffer.byteLength(body)} bytes)`,
    );
  }
  console.log(
    `dataplane: done — ${counts.jobs} jobs · ${counts.companies} companies · ${counts.offices} offices.`,
  );
}

main().catch((e) => {
  console.error("dataplane: fatal —", e);
  process.exit(1);
});
