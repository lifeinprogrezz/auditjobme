#!/usr/bin/env node
/**
 * Logo-domain backfill (issue #68 item 4). Sweeps companies that have a live
 * role but a null logo_domain and derives the domain from the company's own
 * careers_url (falling back to website) via scripts/logo-lib.mjs — the Macadam
 * class (careers.macadam.app -> macadam.app). Hosted-ATS careers URLs
 * (teamtailor/greenhouse/...) never produce a domain: a wrong domain renders a
 * WRONG logo, so null stays null rather than guessing.
 *
 * SAFETY: dry-run is the DEFAULT — reports what it would set, writes nothing.
 * Pass --apply to write (the nightly workflow does; manual runs must opt in).
 *
 * Usage:
 *   node scripts/logo-backfill.mjs            # dry-run (default)
 *   node scripts/logo-backfill.mjs --apply    # write derived logo domains
 */
import { createClient } from "@supabase/supabase-js";
import { deriveLogoDomain } from "./logo-lib.mjs";

const APPLY = process.argv.includes("--apply");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("logo-backfill: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — nothing to do.");
  process.exit(0);
}
const supabase = createClient(url, key);

// Companies with at least one live role (paged; the pool is a few thousand rows).
const liveCompanyIds = new Set();
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from("jobs")
    .select("company_id")
    .eq("is_live", true)
    .not("company_id", "is", null)
    .range(from, from + 999);
  if (error) {
    console.error("logo-backfill: jobs select failed:", error.message);
    process.exit(1);
  }
  for (const r of data || []) liveCompanyIds.add(r.company_id);
  if (!data || data.length < 1000) break;
}

const { data: companies, error } = await supabase
  .from("companies")
  .select("slug, name, careers_url, website")
  .is("logo_domain", null);
if (error) {
  console.error("logo-backfill: companies select failed:", error.message);
  process.exit(1);
}

const candidates = (companies || []).filter((c) => liveCompanyIds.has(c.slug));
const fills = [];
for (const c of candidates) {
  const domain = deriveLogoDomain({ careersUrl: c.careers_url, website: c.website });
  if (domain) fills.push({ slug: c.slug, name: c.name, domain });
}

console.error(
  `logo-backfill: ${candidates.length} null-logo company(ies) with a live role; ${fills.length} derivable${APPLY ? "" : " (DRY RUN — pass --apply to write)"}`,
);
for (const f of fills) console.error(`  ${f.name} (${f.slug}) -> ${f.domain}`);

if (!APPLY) {
  console.error("logo-backfill: DRY RUN — no writes.");
  process.exit(0);
}

let written = 0;
for (const f of fills) {
  const { error: e } = await supabase.from("companies").update({ logo_domain: f.domain }).eq("slug", f.slug);
  if (e) console.error(`logo-backfill: update failed for ${f.slug}: ${e.message}`);
  else written++;
}
console.error(`logo-backfill: wrote ${written} logo domain(s).`);
