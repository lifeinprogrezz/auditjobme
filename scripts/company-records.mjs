#!/usr/bin/env node
/**
 * Company records for every company on the map (issue #153, item B1). About
 * 40% of the companies on live jobs have never had a `companies` row -- no row
 * means no logo domain, no coordinates, no sector, nothing but a name on a job listing
 * (1Password, Adobe and hundreds more). This creates that row.
 *
 * Name = the most common exact spelling seen on today's live jobs for that
 * company (groupByCompanyName, scripts/company-records-lib.mjs) -- the SAME key
 * public.link_jobs_to_companies() matches on (`lower(company) = lower(name)`),
 * so a row this script creates is linkable to its jobs by that RPC on the very
 * next scrape, and by this script's own end-of-run call to the same RPC.
 * Slug via slugForCompany(), matching the underscore-separated convention
 * already live in the table (delivery_hero, mistral_ai...).
 *
 * Bounded to LIMIT new rows per run (default 400, alphabetical so a run is
 * reproducible) so one run never floods the table; the daily scrape closes the
 * rest of the gap over the following days.
 *
 * SAFETY: default WRITES (matches scripts/backfill-headcount.mjs's convention);
 * --dry-run reports what it would create without writing. Upsert with
 * ignoreDuplicates, not insert: a slug collision (this script re-run before the
 * scrape's own link pass catches up, or two names that happen to slugify the
 * same) is skipped, never fatal -- idempotent by construction.
 *
 * Runs in .github/workflows/scrape.yml (service role), non-fatal, BEFORE the
 * logo-domain backfill so the rows it creates are eligible in the same run.
 * Usage: node scripts/company-records.mjs [--limit=400] [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import { groupByCompanyName, slugForCompany, uniqueSlug } from "./company-records-lib.mjs";

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
};
const LIMIT = Number(arg("limit", "400")) || 400;
const DRY = process.argv.includes("--dry-run");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;

async function fetchAllPages(db, build) {
  let rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(db).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows = rows.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function main() {
  if (!db) {
    console.log("company-records: no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY -> nothing written.");
    return;
  }

  // Every live job with no company link yet -- the candidate pool.
  const rows = await fetchAllPages(db, (c) =>
    c.from("jobs").select("company").eq("is_live", true).is("company_id", null),
  );
  const groups = groupByCompanyName(rows);
  console.log(
    `company-records: ${rows.length} live job(s) with no company_id · ${groups.size} distinct company name(s)`,
  );

  // Paged (fix round 3, blocker 2): this script alone has grown `companies`
  // from ~598 to ~1,450 rows in three runs, well past PostgREST's 1000-row
  // un-ranged cap -- an un-paged read here truncated existingSlugs, so
  // uniqueSlug() could hand out a slug that already existed and the
  // ignoreDuplicates upsert below silently dropped that company forever.
  const existing = await fetchAllPages(db, (c) => c.from("companies").select("slug"));
  const existingSlugs = new Set(existing.map((c) => c.slug));

  // Alphabetical so a bounded run is reproducible day to day, not dependent on
  // whatever order Postgres happened to return rows in.
  const candidates = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, LIMIT);

  const inserts = [];
  for (const { name } of candidates) {
    const base = slugForCompany(name);
    if (!base) continue; // no alphanumeric content in the name -- never insert an empty slug
    const slug = uniqueSlug(base, existingSlugs);
    existingSlugs.add(slug); // reserve within this run so two names in the same batch never collide
    inserts.push({ slug, name, source: "jobs-derived" });
  }

  console.log(
    `company-records: ${groups.size} distinct missing · ${inserts.length} to create this run (cap ${LIMIT}) · dry=${DRY}`,
  );
  for (const i of inserts) console.log(`  + ${i.name} -> ${i.slug}`);

  if (DRY || inserts.length === 0) {
    console.log(`company-records: ${DRY ? "DRY RUN — no writes." : "nothing to write."}`);
    return;
  }

  const { error: insErr, count } = await db
    .from("companies")
    .upsert(inserts, { onConflict: "slug", ignoreDuplicates: true, count: "exact" });
  if (insErr) {
    console.error("company-records: insert failed —", insErr.message);
    process.exit(1);
  }
  console.log(`company-records: wrote ${count ?? inserts.length} new companies row(s).`);

  // Link the jobs this run's new rows cover RIGHT NOW, not on tomorrow's scrape --
  // the same RPC scripts/scrape.mjs already calls after ingestion (migration
  // 20260705210000). Idempotent (only touches company_id IS NULL rows).
  const { data: linked, error: linkErr } = await db.rpc("link_jobs_to_companies");
  if (linkErr) console.error("company-records: link_jobs_to_companies failed:", linkErr.message);
  else console.log(`company-records: linked ${linked} job(s) to a company this run.`);
}

// Importable for tests; only the direct run touches the network or the database.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("company-records: fatal —", e);
    process.exit(1);
  });
}
