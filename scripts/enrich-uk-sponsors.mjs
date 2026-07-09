#!/usr/bin/env node
/**
 * UK Skilled-Worker sponsor enrichment for the companies dimension (Phase B slice 4).
 *
 * Fills companies.uk_sponsor_status ('licensed' | 'unmatched' | null) by matching each
 * company name against the UK Home Office "Register of licensed sponsors (workers)".
 * The /roles detail panel shows a "Licensed UK visa sponsor" badge on a company's
 * UK roles when this is 'licensed' — reliable ground truth for the EU job-seeker who
 * needs sponsorship post-Brexit. Ports career-ops/sponsor-fetch.mjs + sponsor-match.mjs.
 *
 * GROUNDED + FAIL-OPEN (mirrors scripts/enrich-companies.mjs):
 *  - The 16 MB register is fetched LIVE each run (never committed to this public repo).
 *  - Only a confident register hit writes 'licensed'; a real multi-token miss writes
 *    'unmatched'; anything uncertain stays null. We NEVER overwrite an existing value
 *    with null — a shaky run can't erase a good prior match.
 *  - NON-FATAL: a gov.uk hiccup logs + exits 0, leaving existing statuses untouched.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to write (dry-runs without).
 * Usage: node scripts/enrich-uk-sponsors.mjs [--limit=N] [--dry-run]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildSponsorsFromCsv, classifySponsor } from "./sponsor-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
};
const LIMIT = Number(arg("limit", "0")) || 0; // 0 = all companies
const DRY = process.argv.includes("--dry-run");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;

const REGISTER_PAGE =
  "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers";

/** Fetch + parse the live Home Office register → { swSet, swNames, count }, or throw. */
async function fetchRegister() {
  const pageHtml = await (
    await fetch(REGISTER_PAGE, { signal: AbortSignal.timeout(30000) })
  ).text();
  const m = pageHtml.match(/https:\/\/assets\.publishing\.service\.gov\.uk\/[^"']+?\.csv/);
  if (!m) throw new Error("CSV link not found on gov.uk publication page");
  const csv = await (await fetch(m[0], { signal: AbortSignal.timeout(60000) })).text();
  const sponsors = buildSponsorsFromCsv(csv);
  if (!sponsors.swNames.length) throw new Error("register parsed to 0 sponsors");
  return { ...sponsors, sourceCsv: m[0] };
}

function loadAliases() {
  try {
    const raw = JSON.parse(readFileSync(path.join(__dirname, "data/uk_sponsor_aliases.json"), "utf8"));
    delete raw._comment;
    return raw;
  } catch {
    return {};
  }
}

async function main() {
  if (!db) {
    console.log("uk-sponsors: no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY → dry-run only, nothing written.");
    // Still exercise the fetch so a missing-creds run surfaces a broken register early.
  }

  let sponsors;
  try {
    sponsors = await fetchRegister();
    console.log(
      `uk-sponsors: register ${sponsors.count} rows · ${sponsors.swNames.length} Skilled-Worker sponsors`,
    );
  } catch (e) {
    console.error(`⚠️  uk-sponsors skipped (${e.message}); leaving existing statuses untouched.`);
    process.exit(0); // NON-FATAL — never fails the scrape chain
  }

  const aliases = loadAliases();
  if (!db) return;

  let q = db.from("companies").select("slug, name, uk_sponsor_status");
  if (LIMIT) q = q.limit(LIMIT);
  const { data: cos, error } = await q;
  if (error) {
    console.error("uk-sponsors: company fetch failed —", error.message);
    process.exit(1);
  }

  const updates = [];
  for (const co of cos ?? []) {
    const status = classifySponsor(co.name, sponsors, aliases);
    // Never write null over an existing value; only write a confident, changed value.
    if (status != null && status !== co.uk_sponsor_status) {
      updates.push({ slug: co.slug, status, from: co.uk_sponsor_status });
    }
  }
  console.log(
    `uk-sponsors: ${cos?.length ?? 0} companies checked · ${updates.length} to update · dry=${DRY}`,
  );

  let wrote = 0;
  for (const u of updates) {
    if (!DRY) {
      const { error: uErr } = await db
        .from("companies")
        .update({ uk_sponsor_status: u.status })
        .eq("slug", u.slug);
      if (uErr) {
        console.error(`  ${u.slug}: write failed — ${uErr.message}`);
        continue;
      }
    }
    wrote++;
    console.log(`  ${u.slug}: ${u.from ?? "(null)"} → ${u.status}`);
  }
  console.log(`uk-sponsors: done — ${DRY ? "would write" : "wrote"} ${wrote}/${updates.length}.`);
}

main().catch((e) => {
  console.error("uk-sponsors: fatal —", e);
  process.exit(1);
});
