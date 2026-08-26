#!/usr/bin/env node
/**
 * Logo-domain backfill (issue #68 item 4). Sweeps companies that have a live
 * role but a null logo_domain and derives the domain from the company's own
 * careers_url (falling back to website) via scripts/logo-lib.mjs — the Macadam
 * class (careers.macadam.app -> macadam.app). Hosted-ATS careers URLs
 * (teamtailor/greenhouse/...) never produce a domain: a wrong domain renders a
 * WRONG logo, so null stays null rather than guessing.
 *
 * Issue #153 item B1: a company with NEITHER a careers_url NOR a website (the
 * job-derived rows scripts/company-records.mjs creates have neither) falls
 * through to a second source — the apply URL of its own live job(s). The same
 * domainFromUrl() already excludes every hosted-ATS/platform host (Greenhouse,
 * Lever, LinkedIn, Notion...), so a resolved domain is the company's own site,
 * never a wrong-company guess; when it resolves, it fills BOTH website and
 * logo_domain in one write.
 *
 * Fix round 1 (this issue): the apply-URL fallback also caught job-board/
 * aggregator hosts not on the GENERIC_HOST_SUFFIXES list -- measured live on
 * prod, welcometothejungle.com alone resolved as 19 companies' "own" domain,
 * ycombinator.com 10. Those hosts are now on the list (logo-lib.mjs), plus a
 * second, data-driven guard here: any derived domain shared by >=3 distinct
 * companies in one run is an aggregator signature and is never written, even
 * for a host the static list doesn't yet name (partitionAggregatorDomains).
 *
 * SAFETY: dry-run is the DEFAULT — reports what it would set, writes nothing.
 * Pass --apply to write (the nightly workflow does; manual runs must opt in).
 *
 * Usage:
 *   node scripts/logo-backfill.mjs            # dry-run (default)
 *   node scripts/logo-backfill.mjs --apply    # write derived logo domains
 */
import { createClient } from "@supabase/supabase-js";
import { resolveLogoDomain, partitionAggregatorDomains } from "./logo-lib.mjs";

const APPLY = process.argv.includes("--apply");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("logo-backfill: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — nothing to do.");
  process.exit(0);
}
const supabase = createClient(url, key);

// Companies with at least one live role (paged; the pool is a few thousand rows).
// Also collect a few apply URLs per company — the item B1 fallback source below.
const liveCompanyIds = new Set();
const urlsByCompany = new Map();
const URLS_PER_COMPANY = 5; // bounded: the first few live roles are enough to try
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from("jobs")
    .select("company_id, url")
    .eq("is_live", true)
    .not("company_id", "is", null)
    .range(from, from + 999);
  if (error) {
    console.error("logo-backfill: jobs select failed:", error.message);
    process.exit(1);
  }
  for (const r of data || []) {
    liveCompanyIds.add(r.company_id);
    const arr = urlsByCompany.get(r.company_id) ?? [];
    if (arr.length < URLS_PER_COMPANY) arr.push(r.url);
    urlsByCompany.set(r.company_id, arr);
  }
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
let viaApplyUrl = 0;
for (const c of candidates) {
  const { domain, derivedWebsite } = resolveLogoDomain({
    careersUrl: c.careers_url,
    website: c.website,
    applyUrls: urlsByCompany.get(c.slug) ?? [],
  });
  if (derivedWebsite) viaApplyUrl++;
  if (domain) fills.push({ slug: c.slug, name: c.name, domain, website: derivedWebsite });
}

// Data-driven aggregator guard (issue #153 fix round 1, blocker 1): a domain
// shared by >=3 distinct companies in this run is an aggregator/ATS host
// that slipped past GENERIC_HOST_SUFFIXES, not a real company site.
const { safe: safeFills, skipped: skippedFills, aggregatorDomains } = partitionAggregatorDomains(fills);
const viaApplyUrlSafe = safeFills.filter((f) => f.website).length;

console.error(
  `logo-backfill: ${candidates.length} null-logo company(ies) with a live role; ${safeFills.length} derivable (${viaApplyUrlSafe} via apply-URL host)${APPLY ? "" : " (DRY RUN — pass --apply to write)"}`,
);
for (const f of safeFills) console.error(`  ${f.name} (${f.slug}) -> ${f.domain}${f.website ? " [+website]" : ""}`);
if (aggregatorDomains.size) {
  console.error(
    `logo-backfill: skipped ${skippedFills.length} company(ies) across ${aggregatorDomains.size} suspected aggregator domain(s) (>=3 companies sharing one derived domain, never written): ${[...aggregatorDomains].join(", ")}`,
  );
  for (const f of skippedFills) console.error(`  SKIPPED ${f.name} (${f.slug}) -> ${f.domain}`);
}

if (!APPLY) {
  console.error("logo-backfill: DRY RUN — no writes.");
  process.exit(0);
}

let written = 0;
for (const f of safeFills) {
  const update = { logo_domain: f.domain };
  if (f.website) update.website = f.website;
  const { error: e } = await supabase.from("companies").update(update).eq("slug", f.slug);
  if (e) console.error(`logo-backfill: update failed for ${f.slug}: ${e.message}`);
  else written++;
}
console.error(`logo-backfill: wrote ${written} logo domain(s).`);
