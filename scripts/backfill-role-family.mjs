#!/usr/bin/env node
/**
 * One-off backfill for jobs.role_family (issue #34, all-vertical engine).
 *
 * Existing rows predate the all-vertical flip: they were ingested under the
 * PM-only gate and carry role_family = null (the client maps null → "Product
 * Manager", the pre-all-vertical convention from the 2026-07-10 headbar spec).
 * This script replays the SAME classifier the scraper now stamps new rows with
 * (classifyRoleFamily in scripts/job-filters.mjs) over every row whose
 * role_family is still null, so old and new rows speak one vocabulary.
 *
 * DRY-RUN BY DEFAULT — prints the per-family counts + a sample, writes nothing.
 * Pass --apply to write. Rows the classifier cannot place stay null (the client
 * fallback keeps rendering them as Product Manager; they were PM-gated at
 * ingest, so a null here is a classifier gap, not junk — listed for review).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-role-family.mjs [--apply] [--live-only]
 *
 * --live-only restricts to is_live rows (default: all rows, so a later
 * resurrection or export never resurfaces an unlabelled row).
 */
import { createClient } from "@supabase/supabase-js";
import { classifyRoleFamily, ROLE_FAMILIES } from "./job-filters.mjs";

const PAGE = 1000; // PostgREST caps un-ranged selects at 1000 rows — page past it.

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apply = process.argv.includes("--apply");
  const liveOnly = process.argv.includes("--live-only");
  if (!url || !key) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required (service role — this touches every row).");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  // Page through every row still missing a role_family.
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("jobs")
      .select("id, title, is_live")
      .is("role_family", null)
      .range(from, from + PAGE - 1);
    if (liveOnly) q = q.eq("is_live", true);
    const { data, error } = await q;
    if (error) {
      console.error("jobs read failed:", error.message);
      process.exit(1);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const byFamily = new Map(ROLE_FAMILIES.map((f) => [f, []]));
  const unplaced = [];
  for (const r of rows) {
    const family = classifyRoleFamily(r.title);
    if (family) byFamily.get(family).push(r);
    else unplaced.push(r);
  }

  console.error(`${rows.length} row(s) with role_family = null${liveOnly ? " (live only)" : ""}.`);
  for (const f of ROLE_FAMILIES) {
    const list = byFamily.get(f);
    console.error(`  ${f.padEnd(12)} ${String(list.length).padStart(5)}  e.g. ${list.slice(0, 3).map((r) => JSON.stringify(r.title)).join(" · ") || "—"}`);
  }
  console.error(`  ${"(unplaced)".padEnd(12)} ${String(unplaced.length).padStart(5)}  stay null → client renders them as Product Manager`);
  if (unplaced.length) {
    console.error("  Unplaced titles (classifier gap — review, don't force):");
    for (const r of unplaced.slice(0, 25)) console.error(`    - ${r.title}`);
    if (unplaced.length > 25) console.error(`    … and ${unplaced.length - 25} more`);
  }

  if (!apply) {
    console.error("\nDry run — nothing written. Re-run with --apply to write.");
    return;
  }

  let written = 0;
  for (const f of ROLE_FAMILIES) {
    const ids = byFamily.get(f).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { error } = await supabase.from("jobs").update({ role_family: f }).in("id", chunk);
      if (error) {
        console.error(`update failed (${f}):`, error.message);
        process.exit(1);
      }
      written += chunk.length;
    }
  }
  console.error(`Backfilled role_family on ${written} row(s); ${unplaced.length} left null.`);
}

main();
