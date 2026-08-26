#!/usr/bin/env node
/**
 * Geocode company offices (issue #153, item B2). There is no geocoder anywhere
 * else in this repo: every company without hand-entered coordinates lands on a
 * sunflower disc around its city centroid, so Barcelona/London/Berlin read as
 * clouds of logos on one point instead of a real map. This writes real street
 * coordinates into `company_offices` (company x city), so the client's own
 * distance-snap (src/hooks/useRolesData.ts officeFor) has something real to
 * snap to.
 *
 * PROVIDER: Nominatim (https://nominatim.openstreetmap.org/search), 1 req/s,
 * identifying User-Agent -- OSM's usage policy for a script, not a browser.
 * Mapbox instead when MAPBOX_TOKEN / MAPBOX_ACCESS_TOKEN is set (checked
 * read-only in GitHub Actions secrets + Vercel env for this issue: neither
 * holds a Mapbox key today, so this repo runs on Nominatim until one is
 * added -- no code change needed when it is).
 *
 * QUERY, TWO STEPS, per (company x city) candidate:
 *   1. address = geocode("{company name}, {job location text}") — the
 *      company's own best-effort address.
 *   2. city    = geocode(address.city) — the SAME city name's centroid, a
 *      query hundreds of OTHER companies in the same city share, so after the
 *      first hit per city this step is almost always a free cache read.
 *   Within MAX_OFFICE_TO_CITY_KM (50km) of each other AND the address hit
 *   passes isTrustworthyOffice (issue #153 fix round 2, blocker 2: street
 *   precision, not an area/highway/boundary class, named for the company)
 *   -> write company_offices. Else, or no address/no city resolved at all
 *   -> nothing (never a guess). The distance check alone cannot catch a
 *   village or a same-word street sitting near itself; the trust gate can.
 *

 * EXISTING OFFICES ARE NEVER OVERWRITTEN (issue #153 fix round 1, blocker 2):
 * every (company_slug, city_key) already in company_offices -- hand-curated
 * seed rows included -- is pre-loaded once before the loop; a resolved
 * candidate matching one of those pairs is skipped (alreadyHadOffice), never
 * upserted. The address/city geocode still runs and still caches (so a later
 * run, once the curated row is gone, does not have to re-query the provider),
 * only the final company_offices write is gated.
 *
 * CACHE: `geocode_cache` (migration 20260827110000), keyed on the exact query
 * text, forever -- a repeat run never re-asks a question it already has the
 * answer to. A cache row is written ONLY at a tuple's terminal state (full
 * success, too-far, or no-result) — never mid-tuple — so a run that exhausts
 * its budget before finishing a tuple leaves it uncached and eligible for a
 * clean retry next time, rather than caching a half-validated answer.
 * DEGRADES GRACEFULLY if the migration is not applied yet: every geocode_cache
 * read/write catches Postgres "relation does not exist" (isMissingTableError)
 * and falls back to no caching for the rest of THIS run — company_offices
 * still gets written, every query is just re-asked next time too.
 *
 * BOUNDED: --budget real network calls per run (default 200 — the rate limit
 * makes 200 calls ~200s), --max-tuples (company, location) candidates
 * considered per run (default 1000, bounds cache-hit bookkeeping cost on a
 * large pool). Idempotent, fail-soft per row, full counters logged.
 *
 * Runs in .github/workflows/scrape.yml (service role), non-fatal, after the
 * logo-domain backfill and before the dataplane publish.
 * Usage: node scripts/geocode-companies.mjs [--budget=200] [--max-tuples=1000] [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import {
  haversineKm,
  MAX_OFFICE_TO_CITY_KM,
  cityKeyFor,
  nominatimSearchUrl,
  parseNominatimResult,
  mapboxSearchUrl,
  parseMapboxResult,
  waitMsFor,
  isMissingTableError,
  officeKey,
  shouldSkipExistingOffice,
  isTrustworthyOffice,
} from "./geocode-lib.mjs";

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
};
const BUDGET = Number(arg("budget", "200")) || 200;
const MAX_TUPLES = Number(arg("max-tuples", "1000")) || 1000;
const LOCATIONS_PER_COMPANY = 3; // distinct location strings tried per company, bounds a single big employer's share
const DRY = process.argv.includes("--dry-run");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || process.env.MAPBOX_ACCESS_TOKEN || null;
const NOMINATIM_USER_AGENT = "northgoing-geocoder (hello@lifeinprogrezz.com)";

const db = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;

const counters = {
  tuples: 0,
  addressCacheHits: 0,
  addressNetworkCalls: 0,
  addressNoResult: 0,
  cityCacheHits: 0,
  cityNetworkCalls: 0,
  cityUnresolved: 0,
  noCityInAddress: 0,
  tooFar: 0,
  untrustworthy: 0,
  officesWritten: 0,
  alreadyHadOffice: 0,
  budgetExhausted: 0,
  networkErrors: 0,
};

let lastRequestAt = null;
let cacheDisabled = false;

function warnCacheDisabled(where) {
  if (cacheDisabled) return;
  cacheDisabled = true;
  console.error(
    `geocode-companies: geocode_cache table not found at ${where} — caching disabled for the rest of this run (apply migration 20260827110000_geocode_cache.sql to enable it).`,
  );
}

/** Read one cached row, or undefined if not cached / caching unavailable. */
async function cacheRead(query) {
  // Dry-run still reads the cache (a real "what would happen" picture, and it
  // skips a tuple already known rather than re-hitting Nominatim for nothing);
  // only the WRITE side is gated on DRY, below.
  if (cacheDisabled || !db) return undefined;
  const { data, error } = await db.from("geocode_cache").select("lat, lng, precision").eq("query", query).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) warnCacheDisabled("read");
    return undefined;
  }
  return data ?? undefined; // undefined = no row; a row with null lat/lng = a cached miss
}

/** Write one cached row (a terminal answer — see the module doc). No-op in
 *  dry-run or once the table is known missing. */
async function cacheWrite(query, result) {
  if (DRY || cacheDisabled || !db) return;
  const { error } = await db
    .from("geocode_cache")
    .upsert({ query, lat: result?.lat ?? null, lng: result?.lng ?? null, precision: result?.precision ?? null }, { onConflict: "query" });
  if (error && isMissingTableError(error)) warnCacheDisabled("write");
}

async function fetchProvider(query) {
  const wait = waitMsFor(lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  const res = MAPBOX_TOKEN
    ? await fetch(mapboxSearchUrl(query, MAPBOX_TOKEN), { signal: AbortSignal.timeout(15000) })
    : await fetch(nominatimSearchUrl(query), {
        headers: { "User-Agent": NOMINATIM_USER_AGENT },
        signal: AbortSignal.timeout(15000),
      });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return MAPBOX_TOKEN ? parseMapboxResult(json) : parseNominatimResult(json);
}

/** Resolve the CITY-centroid query: cache first, else network (budget +
 *  rate-limited), caching the answer immediately either way — a city lookup
 *  is always a standalone, terminal fact, unlike the address query below.
 *  Returns the parsed result, null (no result), or undefined (no budget left
 *  to even try). */
async function resolveCity(cityName) {
  const cached = await cacheRead(cityName);
  if (cached !== undefined) {
    counters.cityCacheHits++;
    return cached.lat != null && cached.lng != null ? { lat: cached.lat, lng: cached.lng } : null;
  }
  if (counters.cityNetworkCalls + counters.addressNetworkCalls >= BUDGET) {
    counters.budgetExhausted++;
    return undefined;
  }
  counters.cityNetworkCalls++;
  let result;
  try {
    result = await fetchProvider(cityName);
  } catch (e) {
    counters.networkErrors++;
    console.error(`geocode-companies: city geocode failed for "${cityName}": ${e.message}`);
    return undefined; // transient — do not cache, retry next run
  }
  await cacheWrite(cityName, result);
  return result;
}

async function main() {
  if (!db) {
    console.log("geocode-companies: no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY -> nothing to do.");
    return;
  }

  // Every (company_slug, city_key) pair that already has a company_offices
  // row -- hand-curated seed data, or a prior run's own write -- so this run
  // never overwrites one (issue #153 fix round 1, blocker 2). Paged.
  const existingOfficeKeys = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("company_offices").select("company_slug, city_key").range(from, from + 999);
    if (error) {
      console.error("geocode-companies: company_offices fetch failed —", error.message);
      process.exit(1);
    }
    for (const r of data || []) existingOfficeKeys.add(officeKey(r.company_slug, r.city_key));
    if (!data || data.length < 1000) break;
  }

  // Every (company, distinct live-job location) pair, via the jobs->companies
  // FK embed — one query, no separate join. Paged (a few thousand rows).
  const byCompany = new Map(); // slug -> { name, locations: Set }
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("jobs")
      .select("company_id, location, companies(name)")
      .eq("is_live", true)
      .not("company_id", "is", null)
      .not("location", "is", null)
      .range(from, from + 999);
    if (error) {
      console.error("geocode-companies: jobs fetch failed —", error.message);
      process.exit(1);
    }
    for (const r of data || []) {
      const loc = String(r.location || "").trim();
      const name = r.companies?.name;
      if (!loc || !name) continue;
      const entry = byCompany.get(r.company_id) ?? { name, locations: new Set() };
      if (entry.locations.size < LOCATIONS_PER_COMPANY) entry.locations.add(loc);
      byCompany.set(r.company_id, entry);
    }
    if (!data || data.length < 1000) break;
  }

  const tuples = [];
  for (const [slug, { name, locations }] of [...byCompany.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const location of [...locations].sort()) tuples.push({ slug, name, location });
  }
  const worklist = tuples.slice(0, MAX_TUPLES);
  console.log(
    `geocode-companies: ${byCompany.size} compan(ies) with live jobs · ${tuples.length} (company, location) candidate(s) · processing ${worklist.length} (cap ${MAX_TUPLES}) · budget ${BUDGET} network call(s) · provider ${MAPBOX_TOKEN ? "mapbox" : "nominatim"}`,
  );

  for (const { slug, name, location } of worklist) {
    counters.tuples++;
    const addressQuery = `${name}, ${location}`;

    const cachedAddress = await cacheRead(addressQuery);
    if (cachedAddress !== undefined) {
      counters.addressCacheHits++;
      continue; // fully processed in a previous run — nothing new to do
    }

    if (counters.addressNetworkCalls + counters.cityNetworkCalls >= BUDGET) {
      counters.budgetExhausted++;
      continue; // out of budget — leave uncached, clean retry next run
    }
    counters.addressNetworkCalls++;
    let address;
    try {
      address = await fetchProvider(addressQuery);
    } catch (e) {
      counters.networkErrors++;
      console.error(`geocode-companies: address geocode failed for "${addressQuery}": ${e.message}`);
      continue; // transient — do not cache, retry next run
    }

    if (!address) {
      counters.addressNoResult++;
      await cacheWrite(addressQuery, null); // terminal: a real "nothing found"
      continue;
    }
    if (!address.city) {
      counters.noCityInAddress++;
      await cacheWrite(addressQuery, address); // terminal: got coordinates, can't validate them
      continue;
    }

    const city = await resolveCity(address.city);
    if (city === undefined) {
      // out of budget mid-tuple — leave the ADDRESS query uncached too, so the
      // whole tuple gets a clean retry (with its own address re-fetch) once
      // budget resets, rather than caching an unvalidated answer.
      counters.budgetExhausted++;
      continue;
    }
    if (!city) {
      counters.cityUnresolved++;
      await cacheWrite(addressQuery, address); // terminal: address resolved, its city didn't independently
      continue;
    }

    const distanceKm = haversineKm([address.lng, address.lat], [city.lng, city.lat]);
    await cacheWrite(addressQuery, address); // terminal either way — see below
    if (distanceKm > MAX_OFFICE_TO_CITY_KM) {
      counters.tooFar++;
      continue;
    }
    // Precision/name/class gate (issue #153 fix round 2, blocker 2): the
    // distance check alone passes an area centroid (a village, a same-word
    // street) that just happens to sit near itself -- isTrustworthyOffice
    // requires an actual street-precision POI named for the company.
    if (!isTrustworthyOffice(address, name)) {
      counters.untrustworthy++;
      if (DRY) {
        console.log(
          `  x ${name} (${slug}) -> ${address.city} hit isn't a trustworthy company address ` +
            `(precision=${address.precision}, class=${address.class || "?"}, name=${address.name || "?"}) — skipped`,
        );
      }
      continue;
    }

    const office = {
      company_slug: slug,
      city_key: cityKeyFor(address.city),
      city: address.city,
      address: address.displayName,
      lat: address.lat,
      lng: address.lng,
    };
    if (shouldSkipExistingOffice(existingOfficeKeys, office.company_slug, office.city_key)) {
      counters.alreadyHadOffice++;
      if (DRY) console.log(`  = ${name} (${slug}) -> ${office.city} already has an office on file, not overwriting`);
      continue;
    }
    if (DRY) {
      counters.officesWritten++;
      console.log(`  + ${name} (${slug}) -> ${office.city} @ ${office.lat},${office.lng} (${distanceKm.toFixed(1)}km from centroid)`);
      continue;
    }
    const { error } = await db.from("company_offices").upsert(office, { onConflict: "company_slug,city_key" });
    if (error) console.error(`geocode-companies: company_offices write failed for ${slug}/${office.city_key}: ${error.message}`);
    else counters.officesWritten++;
  }

  console.log(
    `geocode-companies: done — ${counters.tuples} tuple(s) considered · ${counters.officesWritten} office(s) ${DRY ? "would be written" : "written"} · ${counters.alreadyHadOffice} already had an office (not overwritten) · ` +
      `address cache hits ${counters.addressCacheHits} · address network calls ${counters.addressNetworkCalls} · address no-result ${counters.addressNoResult} · no-city-in-address ${counters.noCityInAddress} · ` +
      `city cache hits ${counters.cityCacheHits} · city network calls ${counters.cityNetworkCalls} · city unresolved ${counters.cityUnresolved} · ` +
      `too-far (>${MAX_OFFICE_TO_CITY_KM}km) ${counters.tooFar} · untrustworthy hit (precision/name/class gate) ${counters.untrustworthy} · budget-exhausted skips ${counters.budgetExhausted} · network errors ${counters.networkErrors} · caching ${cacheDisabled ? "DISABLED (migration not applied)" : "on"}`,
  );
}

// Importable for tests; only the direct run touches the network or the database.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("geocode-companies: fatal —", e);
    process.exit(1);
  });
}
