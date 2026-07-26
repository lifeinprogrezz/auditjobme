#!/usr/bin/env node
/**
 * Fill missing `companies.headcount_bucket` from startupmap.one (issue #68, item 6).
 *
 * Company size bucket alone carries about 95% of the deterministic ranker's power
 * (planning repo, 2026-07-26 pre-filter measurement), and on 2026-07-26 it was
 * null for 72 of the 311 companies with a live role. This pass closes the part of
 * that gap a source we already hold can honestly close.
 *
 * THE ONE SOURCE. startupmap.one's /api/startups is already a scrape source
 * (scripts/sources/vc-startupmap.mjs reads the same endpoint for jobs). Its
 * company directory carries numeric `team_size_min` / `team_size_max` for about
 * 93% of 4,300+ European startups. We match by normalized company name and only
 * accept a UNIQUE match, because a wrong company is worse than no size (issue #68
 * item 2 is the same failure in a different column).
 *
 * WHAT WE DO NOT DO. No LinkedIn. It carries the size and 43 of the 72 companies
 * have a linkedin_url on file, but this is a public product and scraping it at
 * scale is a terms problem — the same reasoning that killed the vendor route on
 * issue #41 (Proxycurl was shut down under a LinkedIn injunction, July 2025).
 * Job-description bodies, homepages and stored descriptions were all measured and
 * yield essentially nothing — see scripts/headcount-lib.mjs for the numbers.
 * A company we cannot fill honestly stays null.
 *
 * Every write goes through normalizeHeadcountBucket(), so only the canonical
 * vocabulary can reach the column. Never overwrites a bucket that is already set.
 *
 * Runs in .github/workflows/scrape.yml (service role), non-fatal.
 * Usage: node scripts/backfill-headcount.mjs [--limit=1000] [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import { pfetch } from "./sources/_proxy.mjs";
import {
  HEADCOUNT_BUCKETS,
  bucketForRange,
  companyKey,
  normalizeHeadcountBucket,
} from "./headcount-lib.mjs";

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
};
const LIMIT = Number(arg("limit", "1000")) || 1000;
const DRY = process.argv.includes("--dry-run");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STARTUPMAP_STARTUPS = "https://startupmap.one/api/startups";
const UA = "career-ops/1.0 (+lifeinprogrezz personal)";

const db = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;

/** The directory endpoint returns either a bare array or an object wrapping one. */
function extractArray(payload, keyHint) {
  if (Array.isArray(payload)) return payload;
  if (keyHint && Array.isArray(payload?.[keyHint])) return payload[keyHint];
  for (const k of Object.keys(payload || {})) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  return [];
}

/**
 * name-key → canonical bucket, for the startupmap companies that state a size.
 * A key claimed by more than one company is dropped: ambiguous identity means we
 * cannot tell whose size we would be writing.
 */
export function buildSizeIndex(companies) {
  const byKey = new Map();
  for (const c of companies) {
    const key = companyKey(c?.name);
    if (!key) continue;
    const bucket = bucketForRange(c?.team_size_min, c?.team_size_max);
    const prev = byKey.get(key);
    if (prev === undefined) byKey.set(key, { bucket, name: c.name, ambiguous: false });
    else prev.ambiguous = true;
  }
  const out = new Map();
  for (const [key, v] of byKey) {
    if (!v.ambiguous && v.bucket) out.set(key, { bucket: v.bucket, name: v.name });
  }
  return out;
}

/** Short names are where a name-only match goes wrong — a directory's "Light" or
 *  "Box" or "Stream" is very likely a different company from ours. Below the
 *  threshold we demand the two display names be the same string, not just the
 *  same normalized key ("Light Inc" is not "Light"). */
const MIN_KEY_LENGTH = 6;
export function matchIsSafe(ourName, theirName, key) {
  if (!key) return false;
  if (key.length >= MIN_KEY_LENGTH) return true;
  return String(ourName).trim().toLowerCase() === String(theirName).trim().toLowerCase();
}

async function fetchStartupmap() {
  const res = await pfetch(STARTUPMAP_STARTUPS, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`startups HTTP ${res.status}`);
  return extractArray(await res.json(), "startups");
}

async function main() {
  let index;
  try {
    const companies = await fetchStartupmap();
    index = buildSizeIndex(companies);
    console.log(
      `backfill-headcount: startupmap ${companies.length} companies · ${index.size} usable sizes`,
    );
  } catch (e) {
    console.error(`⚠️  backfill-headcount skipped (${e.message}); buckets left untouched.`);
    process.exit(0); // NON-FATAL — never fails the scrape chain
  }

  if (!db) {
    console.log(
      "backfill-headcount: no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY → nothing written.",
    );
    return;
  }

  const { data: cos, error } = await db
    .from("companies")
    .select("slug, name")
    .is("headcount_bucket", null)
    .limit(LIMIT);
  if (error) {
    console.error("backfill-headcount: company fetch failed —", error.message);
    process.exit(1);
  }

  const updates = [];
  for (const co of cos ?? []) {
    const key = companyKey(co.name);
    const hit = index.get(key);
    if (!hit || !matchIsSafe(co.name, hit.name, key)) continue;
    const bucket = normalizeHeadcountBucket(hit.bucket); // the ONE way in
    if (!bucket) continue;
    updates.push({ slug: co.slug, name: co.name, via: hit.name, bucket });
  }
  console.log(
    `backfill-headcount: ${cos?.length ?? 0} companies with no bucket · ${updates.length} fillable · dry=${DRY}`,
  );

  let wrote = 0;
  for (const u of updates) {
    if (!DRY) {
      const { error: uErr } = await db
        .from("companies")
        .update({ headcount_bucket: u.bucket })
        .eq("slug", u.slug)
        .is("headcount_bucket", null); // never overwrite a value that landed meanwhile
      if (uErr) {
        console.error(`  ${u.slug}: write failed — ${uErr.message}`);
        continue;
      }
    }
    wrote++;
    console.log(`  ${u.slug}: → ${u.bucket} (startupmap "${u.via}")`);
  }
  const remaining = (cos?.length ?? 0) - wrote;
  console.log(
    `backfill-headcount: done — ${DRY ? "would write" : "wrote"} ${wrote}/${updates.length}` +
      ` · ${remaining} still null (no honest source) · vocabulary ${HEADCOUNT_BUCKETS.join(" · ")}`,
  );
}

// Importable for tests; only the direct run touches the network or the database.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("backfill-headcount: fatal —", e);
    process.exit(1);
  });
}
