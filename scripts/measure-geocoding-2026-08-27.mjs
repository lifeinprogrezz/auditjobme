#!/usr/bin/env node
/**
 * THROWAWAY MEASUREMENT SCRIPT — not part of the product, not wired into any
 * workflow, safe to delete. It exists to produce the numbers in
 * docs/geocoding-measurement-2026-08-27.md and nothing else.
 *
 * Question it answers: can a company office coordinate be obtained for FREE,
 * well enough to skip paying Mapbox for permanent geocoding?
 *
 * It is READ-ONLY everywhere: it reads the PUBLIC dataplane artifact
 * (…/storage/v1/object/public/dataplane/…), never the database, and it writes
 * nothing back. It calls only free public endpoints, politely.
 *
 * Stages (run one at a time):
 *   node scripts/measure-geocoding-2026-08-27.mjs sample   # build the shared sample
 *   node scripts/measure-geocoding-2026-08-27.mjs h1photon # OSM POI via Photon
 *   node scripts/measure-geocoding-2026-08-27.mjs h1overpass
 *   node scripts/measure-geocoding-2026-08-27.mjs h2       # website -> address -> Nominatim
 *   node scripts/measure-geocoding-2026-08-27.mjs report
 *
 * Work dir: --dir=<path> (default ./.geo-measure). Every stage writes a JSON
 * there so a later stage never re-asks a free endpoint a question it already
 * asked.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The sample must use the SAME city resolver the /roles map uses, so this
// bundles src/lib/geo.ts rather than re-implementing cityOf. The bundle is a
// build artifact: generated on demand, never committed.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEO_BUNDLE = path.join(HERE, ".geo-bundle.generated.mjs");
if (!fs.existsSync(GEO_BUNDLE)) {
  execFileSync(
    path.join(HERE, "..", "node_modules", ".bin", "esbuild"),
    [path.join(HERE, "..", "src", "lib", "geo.ts"), "--bundle", "--format=esm", "--platform=node", `--outfile=${GEO_BUNDLE}`],
    { stdio: "inherit" },
  );
}
const { cityOf, coordsOf } = await import(`file://${GEO_BUNDLE}`);

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split("=").slice(1).join("=") : d;
};
const DIR = arg("dir", ".geo-measure");
const SAMPLE_SIZE = Number(arg("sample-size", "70"));
const SEED = arg("seed", "geo-sample-2026-08-27");
const DATAPLANE = arg(
  "dataplane",
  "https://roaervdsjejksaeseeov.supabase.co/storage/v1/object/public/dataplane",
);
const UA = "auditjobme-geocoding-measurement/1.0 (one-off research; hello@lifeinprogrezz.com)";

fs.mkdirSync(DIR, { recursive: true });
const p = (f) => path.join(DIR, f);
const readJson = (f) => JSON.parse(fs.readFileSync(p(f), "utf8"));
const writeJson = (f, v) => fs.writeFileSync(p(f), JSON.stringify(v, null, 2));

// ---- request accounting: every network call this script makes is counted ----
const counters = {};
let totalRequests = 0;
const HARD_CAP = Number(arg("cap", "1200"));
async function req(kind, url, opts = {}) {
  if (totalRequests >= HARD_CAP) throw new Error(`hard request cap ${HARD_CAP} reached`);
  totalRequests += 1;
  counters[kind] = (counters[kind] || 0) + 1;
  const ctl = AbortSignal.timeout(opts.timeout ?? 15000);
  return fetch(url, { ...opts, signal: ctl, headers: { "User-Agent": UA, ...(opts.headers || {}) } });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const R = 6371;
const km = ([lng1, lat1], [lng2, lat2]) => {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
};
/** Same acceptance radius scripts/geocode-lib.mjs already uses in production. */
const MAX_KM = 50;

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(gmbh|ltd|limited|inc|bv|b\.v\.|ab|as|a\/s|oy|sa|s\.a\.|sl|s\.l\.|srl|spa|plc|holding|group|technologies|technology|labs|ai|io|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// ---------------------------------------------------------------- stage: sample
async function stageSample() {
  const dpPath = p("dataplane.json");
  if (!fs.existsSync(dpPath)) {
    const res = await req("dataplane", `${DATAPLANE}/dataplane.json`, { timeout: 60000 });
    fs.writeFileSync(dpPath, Buffer.from(await res.arrayBuffer()));
  }
  const jobsPath = p("jobs.ndjson");
  if (!fs.existsSync(jobsPath)) {
    const res = await req("dataplane", `${DATAPLANE}/jobs.ndjson`, { timeout: 60000 });
    fs.writeFileSync(jobsPath, Buffer.from(await res.arrayBuffer()));
  }
  const dp = JSON.parse(fs.readFileSync(dpPath, "utf8"));
  const bySlug = new Map(dp.companies.map((c) => [c.slug, c]));
  const hasOffice = new Set(dp.offices.map((o) => o.company_slug));

  // Every live job -> the city the /roles map resolves for it (production cityOf).
  const cityCount = new Map(); // slug -> Map(city -> n)
  for (const line of fs.readFileSync(jobsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (!j.company_id) continue;
    const city = cityOf(j.location ?? null);
    if (!city || !coordsOf(city)) continue;
    const m = cityCount.get(j.company_id) ?? new Map();
    m.set(city, (m.get(city) ?? 0) + 1);
    cityCount.set(j.company_id, m);
  }

  const pool = [];
  for (const [slug, cities] of cityCount) {
    if (hasOffice.has(slug)) continue; // only companies WITHOUT an office coordinate
    const co = bySlug.get(slug);
    if (!co) continue;
    if (co.lat != null && co.lng != null) continue; // already has a real point
    const [city] = [...cities.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    pool.push({
      slug,
      name: co.slug === slug ? co.name ?? slug : slug,
      city,
      centroid: coordsOf(city),
      website: co.website || (co.logo_domain ? `https://${co.logo_domain}` : null),
      hq_city: co.hq_city ?? null,
      hq_country: co.hq_country ?? null,
    });
  }
  // Company display names are not in the dataplane company row; take them from jobs.
  const nameBySlug = new Map();
  for (const line of fs.readFileSync(jobsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (j.company_id && j.company && !nameBySlug.has(j.company_id)) nameBySlug.set(j.company_id, j.company);
  }
  for (const r of pool) r.name = nameBySlug.get(r.slug) || r.slug;

  // Deterministic shuffle: FNV-1a of (slug + seed) — a reproducible random sample.
  const h = (s) => {
    let x = 2166136261;
    for (let i = 0; i < s.length; i++) {
      x ^= s.charCodeAt(i);
      x = Math.imul(x, 16777619) >>> 0;
    }
    return x;
  };
  pool.sort((a, b) => h(a.slug + SEED) - h(b.slug + SEED) || a.slug.localeCompare(b.slug));
  const sample = pool.slice(0, SAMPLE_SIZE);
  writeJson("sample.json", { seed: SEED, pool_size: pool.length, sample });
  console.log(
    `pool (live jobs, no office, mappable city) = ${pool.length}; sample = ${sample.length}; ` +
      `sample with a website = ${sample.filter((s) => s.website).length}`,
  );
}

// ---------------------------------------------------------------- stage: sites
/** H2 needs a company website, and production only has one for ~42% of the
 *  office-less pool. Recover a few more from the PUBLIC ATS board APIs the
 *  sample's jobs already point at (Ashby + Workable both publish the company's
 *  own site on their public job-board endpoint). Read-only, one request per
 *  company, and it only ADDS to sample.json — it never removes a company, so
 *  the sample carried through every hypothesis stays the same 70. */
async function stageSites() {
  const s = readJson("sample.json");
  const firstJob = new Map();
  for (const line of fs.readFileSync(p("jobs.ndjson"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (j.company_id && !firstJob.has(j.company_id)) firstJob.set(j.company_id, j);
  }
  for (const c of s.sample) {
    if (c.website) continue;
    const j = firstJob.get(c.slug);
    if (!j) continue;
    try {
      // Ashby's public posting-api carries no company website (verified live
      // 2026-08-27: the response has only `jobs` + `apiVersion`), so there is
      // nothing to recover there. Workable's widget account endpoint does.
      const workable = /apply\.workable\.com\/([^/?#]+)/.exec(j.url);
      if (workable) {
        const res = await req("board", `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(workable[1])}`);
        const json = await res.json();
        const site = json?.website || json?.company?.website;
        if (site && /^https?:/.test(site)) c.website = site;
      }
    } catch {
      /* a board that will not answer is simply no website for this company */
    }
    if (c.website) console.log(`site ${c.slug} -> ${c.website}`);
    await sleep(700);
  }
  writeJson("sample.json", s);
  console.log(`sample with a website now = ${s.sample.filter((x) => x.website).length}/${s.sample.length}`);
}

// ------------------------------------------------------------- stage: H1 Photon
async function stageH1Photon() {
  const { sample } = readJson("sample.json");
  const out = [];
  for (const c of sample) {
    const [lng, lat] = c.centroid;
    const url =
      "https://photon.komoot.io/api?" +
      new URLSearchParams({ q: `${c.name} ${c.city}`, lat: String(lat), lon: String(lng), limit: "5", lang: "en" });
    let hits = [];
    let error = null;
    try {
      const res = await req("photon", url);
      if (res.status === 429) throw new Error("rate limited (429) — stopping");
      const json = await res.json();
      hits = (json.features || []).map((f) => ({
        name: f.properties?.name ?? null,
        osm_key: f.properties?.osm_key ?? null,
        osm_value: f.properties?.osm_value ?? null,
        street: f.properties?.street ?? null,
        housenumber: f.properties?.housenumber ?? null,
        city: f.properties?.city ?? null,
        country: f.properties?.country ?? null,
        lng: f.geometry?.coordinates?.[0],
        lat: f.geometry?.coordinates?.[1],
      }));
    } catch (e) {
      error = String(e.message || e);
      if (/rate limited/.test(error)) {
        console.error(error);
        break;
      }
    }
    const accepted = pickPoi(hits, c);
    out.push({ slug: c.slug, name: c.name, city: c.city, error, n_hits: hits.length, accepted, hits: hits.slice(0, 3) });
    console.log(`photon ${c.slug}: ${accepted ? `HIT ${accepted.name} @${accepted.km.toFixed(1)}km` : "miss"}`);
    await sleep(1100);
  }
  writeJson("h1-photon.json", { requests: counters.photon || 0, results: out });
}

/** Accept an OSM feature as "this company's office" only when it is
 *  (a) named for the company, (b) not a city/boundary/administrative feature,
 *  and (c) within MAX_KM of the city centroid the map would otherwise use. */
function pickPoi(hits, c) {
  const want = norm(c.name);
  if (!want) return null;
  for (const hFeat of hits) {
    if (hFeat.lat == null || hFeat.lng == null) continue;
    const key = hFeat.osm_key;
    if (key === "place" || key === "boundary" || key === "highway" || key === "landuse") continue;
    const got = norm(hFeat.name);
    if (!got) continue;
    const nameMatch = got === want || got.startsWith(want + " ") || want.startsWith(got + " ");
    if (!nameMatch) continue;
    const d = km(c.centroid, [hFeat.lng, hFeat.lat]);
    if (d > MAX_KM) continue;
    return { ...hFeat, km: d };
  }
  return null;
}

// ----------------------------------------------------------- stage: H1 Overpass
async function stageH1Overpass() {
  const { sample } = readJson("sample.json");
  const prior = fs.existsSync(p("h1-overpass.json")) ? readJson("h1-overpass.json").results : [];
  const done = new Set(prior.filter((r) => !r.error).map((r) => r.slug));
  const out = prior.filter((r) => !r.error);
  let rateLimited = 0;
  for (const c of sample) {
    if (done.has(c.slug)) continue;
    const [lng, lat] = c.centroid;
    const esc = c.name.replace(/["\\]/g, "\\$&");
    // EXACT name, tag-index first. A case-insensitive regex over a 30km disc
    // times out on the public instance (measured: 48s -> 504), an exact name
    // match returns in well under a second — and an exact match is the gate
    // this measurement concluded a name-based lookup needs anyway.
    const q = `[out:json][timeout:25];nwr["name"="${esc}"](around:30000,${lat},${lng});out center 3;`;
    let elements = [];
    let error = null;
    try {
      const res = await req("overpass", "https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: "data=" + encodeURIComponent(q),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 40000,
      });
      if (res.status === 429) {
        // Back off once, politely, before giving up on the endpoint.
        rateLimited += 1;
        if (rateLimited > 3) throw new Error("rate limited (429) repeatedly — stopping");
        console.log("overpass 429 — waiting 60s");
        await sleep(60000);
        out.push({ slug: c.slug, name: c.name, city: c.city, error: "429 (retry next run)", n_hits: 0, accepted: null });
        continue;
      }
      const body = await res.text();
      if (!body.trim().startsWith("{")) throw new Error(`non-json response (${res.status})`);
      const json = JSON.parse(body);
      elements = (json.elements || []).map((e) => ({
        type: e.type,
        name: e.tags?.name ?? null,
        office: e.tags?.office ?? e.tags?.amenity ?? e.tags?.shop ?? null,
        street: e.tags?.["addr:street"] ?? null,
        housenumber: e.tags?.["addr:housenumber"] ?? null,
        lat: e.lat ?? e.center?.lat,
        lng: e.lon ?? e.center?.lon,
      }));
    } catch (e) {
      error = String(e.message || e);
      if (/rate limited/.test(error)) {
        console.error(error);
        break;
      }
    }
    const first = elements.find((e) => e.lat != null && e.lng != null);
    const accepted = first ? { ...first, km: km(c.centroid, [first.lng, first.lat]) } : null;
    out.push({ slug: c.slug, name: c.name, city: c.city, error, n_hits: elements.length, accepted });
    console.log(`overpass ${c.slug}: ${accepted ? `HIT ${accepted.name} @${accepted.km.toFixed(1)}km` : "miss"}`);
    writeJson("h1-overpass.json", { requests: counters.overpass || 0, results: out });
    await sleep(5000);
  }
  writeJson("h1-overpass.json", { requests: counters.overpass || 0, results: out });
}

// ------------------------------- stage: H2 website -> postal address -> Nominatim
const CONTACT_RE = /impressum|imprint|kontakt|contact|legal|mentions-legales|about-us|aviso-legal|privacy/i;

function absolute(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|address|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t\u00a0]+/g, " ");

/** schema.org PostalAddress out of any JSON-LD block — the highest-precision
 *  extractor, because the site itself declared the fields. */
function jsonLdAddress(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const walk = (v) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) return v.forEach(walk);
      const t = v["@type"];
      const isAddr = t === "PostalAddress" || (Array.isArray(t) && t.includes("PostalAddress"));
      if (isAddr && (v.streetAddress || v.postalCode)) {
        const parts = [v.streetAddress, [v.postalCode, v.addressLocality].filter(Boolean).join(" "), v.addressCountry?.name ?? v.addressCountry]
          .filter((x) => typeof x === "string" && x.trim());
        if (parts.length) out.push(parts.join(", "));
      }
      Object.values(v).forEach(walk);
    };
    walk(data);
  }
  return out;
}

/** A postal address in plain text. Written against what European contact /
 *  Impressum / legal-notice pages ACTUALLY print, checked by hand against the
 *  sample's own pages: the first version of this function missed doccla's
 *  "184 Shepherds Bush Road, London W6 7NL" because the site prints it inside
 *  one element, so the two-line rule never fired and the numeric-postcode rule
 *  cannot see a UK postcode. Three anchors now, all single-line:
 *    A. continental  "<street> <no>, <4-5 digit code> <city>"
 *    B. UK           "<address words>, <city> <outcode> <incode>"
 *    C. Dutch        "<street> <no>, 1234 AB <city>"
 *  DENY catches the split-number noise ("ISO 27001" -> "ISO 2, 7001") and the
 *  company-registration numbers that look like postcodes. */
const DENY = /\b(iso|ste|suite|vat|reg\.?\s?no|company no|version|updated|certif)/i;

function textAddress(text) {
  const flat = text.replace(/\s*\n\s*/g, ", ").replace(/,\s*,/g, ",").replace(/\s+/g, " ");
  const out = [];
  const push = (v) => {
    const t = v.replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "");
    if (t.length >= 10 && t.length <= 120 && !DENY.test(t) && !out.includes(t)) out.push(t);
  };

  // A. continental: street + house number, then a 4-5 digit postcode + city.
  const contRe =
    /\b([\p{Lu}][\p{L}.'\-\u2019]{2,30}(?:[ -][\p{L}][\p{L}.'\-\u2019]{1,30}){0,3}\s\d{1,4}\s?[a-zA-Z]?)\s*,?\s*((?:[A-Z]{1,2}-)?\d{4,5})\s+([\p{Lu}][\p{L}\-. '\u2019]{2,40})/gu;
  // C. Dutch: "1234 AB City" postcode form.
  const nlRe =
    /\b([\p{Lu}][\p{L}.'\-\u2019]{2,30}(?:[ -][\p{L}][\p{L}.'\-\u2019]{1,30}){0,3}\s\d{1,4}\s?[a-zA-Z]?)\s*,?\s*(\d{4}\s?[A-Z]{2})\s+([\p{Lu}][\p{L}\-. '\u2019]{2,40})/gu;
  // B. UK: anchor on the postcode, take the text just before it as the address.
  const ukRe = /\b([A-Z]{1,2}\d[A-Z\d]?)\s?(\d[A-Z]{2})\b/g;

  let m;
  while ((m = contRe.exec(flat)) && out.length < 8) push(`${m[1]}, ${m[2]} ${m[3]}`);
  while ((m = nlRe.exec(flat)) && out.length < 8) push(`${m[1]}, ${m[2]} ${m[3]}`);
  while ((m = ukRe.exec(flat)) && out.length < 8) {
    const before = flat.slice(Math.max(0, m.index - 90), m.index);
    // Keep from the last house-number-looking token onward — that is where the
    // street line starts once the surrounding page prose is dropped.
    const cut = /(\d{1,4}[a-zA-Z]?\s+[\p{Lu}][^,|]{0,60}(?:,\s?[^,|]{0,40}){0,3})\s*$/u.exec(before.replace(/[|•·]/g, ","));
    if (!cut) continue;
    push(`${cut[1]} ${m[1]} ${m[2]}`);
  }
  return out;
}

/** Cached on disk by URL: a rewrite of the extractor must not cost the sample's
 *  websites another round of traffic. */
async function fetchHtml(url) {
  const dir = p("pages");
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, crypto.createHash("sha1").update(url).digest("hex") + ".html");
  if (fs.existsSync(key)) {
    const body = fs.readFileSync(key, "utf8");
    return body === "" ? null : body;
  }
  try {
    const res = await req("website", url, { redirect: "follow", timeout: 20000 });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!/html/i.test(ct)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 3_000_000) return null;
    const html = new TextDecoder("utf-8").decode(buf);
    fs.writeFileSync(key, html);
    return html;
  } catch {
    fs.writeFileSync(key, "");
    return null;
  }
}

let lastNominatim = 0;
async function nominatim(query) {
  const wait = Math.max(0, 1100 - (Date.now() - lastNominatim));
  if (wait) await sleep(wait);
  lastNominatim = Date.now();
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({ q: query, format: "jsonv2", addressdetails: "1", limit: "1" });
  const res = await req("nominatim", url, { timeout: 20000 });
  if (res.status === 429) throw new Error("nominatim rate limited (429) — stopping");
  const json = await res.json();
  const hit = Array.isArray(json) ? json[0] : null;
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const a = hit.address || {};
  return {
    lat,
    lng,
    display: hit.display_name,
    precision: a.house_number ? "housenumber" : a.road ? "street" : "coarse",
  };
}

async function stageH2() {
  const { sample } = readJson("sample.json");
  const prior = fs.existsSync(p("h2.json")) ? readJson("h2.json").results : [];
  const done = new Set(prior.map((r) => r.slug));
  const out = [...prior];
  for (const c of sample) {
    if (done.has(c.slug)) continue;
    const rec = { slug: c.slug, name: c.name, city: c.city, website: c.website, pages: [], addresses: [], geo: null, accepted: null };
    if (c.website) {
      const home = await fetchHtml(c.website);
      const tried = [];
      if (home) {
        rec.pages.push(c.website);
        rec.addresses.push(...jsonLdAddress(home), ...textAddress(strip(home)));
        // Candidate pages, best first: an Impressum / legal notice is a legal
        // obligation to print the address, a contact page usually does, a
        // privacy policy sometimes does. Rank, do not just take the first
        // three links in DOM order.
        const rank = (u) =>
          /impressum|imprint|legal-notice|mentions-legales|aviso-legal/i.test(u) ? 0
          : /kontakt|contact/i.test(u) ? 1
          : /legal|about/i.test(u) ? 2
          : 3;
        const links = new Set();
        const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
        let m;
        while ((m = re.exec(home))) {
          const url = absolute(c.website, m[1]);
          if (!url || !/^https?:/.test(url)) continue;
          if (!CONTACT_RE.test(m[1]) && !CONTACT_RE.test(strip(m[2]))) continue;
          if (new URL(url).host !== new URL(c.website).host) continue;
          links.add(url);
        }
        // Guessed paths, for the sites that put the Impressum in the footer of
        // a JS-rendered page the crawler never sees as an <a>.
        for (const guess of ["/impressum", "/imprint", "/contact", "/legal-notice"]) {
          const u = absolute(c.website, guess);
          if (u) links.add(u);
        }
        const ordered = [...links].sort((a, b) => rank(a) - rank(b)).slice(0, 4);
        for (const url of ordered) {
          tried.push(url);
          const html = await fetchHtml(url);
          if (!html) continue;
          rec.pages.push(url);
          rec.addresses.push(...jsonLdAddress(html), ...textAddress(strip(html)));
        }
      }
      rec.tried = tried;
    }
    rec.addresses = [...new Set(rec.addresses.map((a) => a.replace(/\s+/g, " ").trim()))].slice(0, 6);
    for (const addr of rec.addresses) {
      let g = null;
      try {
        g = await nominatim(addr);
      } catch (e) {
        rec.error = String(e.message || e);
        break;
      }
      if (!g) continue;
      const d = km(c.centroid, [g.lng, g.lat]);
      rec.geo = { addr, ...g, km: d };
      if (d <= MAX_KM && g.precision !== "coarse") {
        rec.accepted = rec.geo;
        break;
      }
    }
    out.push(rec);
    console.log(
      `h2 ${c.slug}: ${rec.website ? "" : "no-website "}addr=${rec.addresses.length} ` +
        `${rec.accepted ? `HIT ${rec.accepted.precision} @${rec.accepted.km.toFixed(1)}km` : "miss"}`,
    );
    writeJson("h2.json", { requests: { website: counters.website || 0, nominatim: counters.nominatim || 0 }, results: out });
    if (rec.error) break;
  }
  writeJson("h2.json", { requests: { website: counters.website || 0, nominatim: counters.nominatim || 0 }, results: out });
}

// ------------------------------------------------- stage: H3 ATS board address
/** H3: the ATS board the job already comes from may publish a structured
 *  postal address. Ashby's public posting-api does (schema.org PostalAddress
 *  per job). A city-only address is worthless here — the map already knows the
 *  city — so only a `streetAddress` counts, and it is geocoded with Nominatim
 *  exactly like an H2 address. */
async function stageH3Board() {
  const { sample } = readJson("sample.json");
  const firstJob = new Map();
  for (const line of fs.readFileSync(p("jobs.ndjson"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (j.company_id && !firstJob.has(j.company_id)) firstJob.set(j.company_id, j);
  }
  const out = [];
  for (const c of sample) {
    const j = firstJob.get(c.slug);
    const rec = { slug: c.slug, name: c.name, city: c.city, board: null, addressed: 0, street: null, accepted: null };
    const ashby = j && /jobs\.ashbyhq\.com\/([^/?#]+)/.exec(j.url);
    if (ashby) {
      rec.board = "ashby";
      try {
        const res = await req("board", `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ashby[1])}`);
        const json = await res.json();
        for (const job of json.jobs || []) {
          const a = job.address?.postalAddress;
          if (!a) continue;
          rec.addressed += 1;
          if (a.streetAddress && !rec.street) {
            rec.street = [a.streetAddress, [a.postalCode, a.addressLocality].filter(Boolean).join(" "), a.addressCountry]
              .filter((x) => typeof x === "string" && x.trim())
              .join(", ");
          }
        }
      } catch (e) {
        rec.error = String(e.message || e);
      }
      await sleep(700);
    }
    if (rec.street) {
      try {
        const g = await nominatim(rec.street);
        if (g) {
          const d = km(c.centroid, [g.lng, g.lat]);
          if (d <= MAX_KM && g.precision !== "coarse") rec.accepted = { addr: rec.street, ...g, km: d };
          else rec.geo = { addr: rec.street, ...g, km: d };
        }
      } catch (e) {
        rec.error = String(e.message || e);
      }
    }
    out.push(rec);
    console.log(`h3 ${c.slug}: board=${rec.board ?? "-"} street=${rec.street ? "yes" : "no"} ${rec.accepted ? "HIT" : "miss"}`);
  }
  writeJson("h3-board.json", { requests: { board: counters.board || 0, nominatim: counters.nominatim || 0 }, results: out });
}

// ----------------------------------------------------------------- stage: probe
/** Extractor smoke check: `probe --url=<page>` prints what textAddress +
 *  jsonLdAddress pull out of one page. Used to watch the extractor go from
 *  red to green on the page that exposed its first version's blind spot
 *  (doccla.com/contact, a UK address inside a single element). */
async function stageProbe() {
  const url = arg("url", null);
  if (!url) throw new Error("probe needs --url=");
  const html = await fetchHtml(url);
  if (!html) return console.log("no html");
  console.log("jsonld:", JSON.stringify(jsonLdAddress(html)));
  console.log("text  :", JSON.stringify(textAddress(strip(html))));
}

// ---------------------------------------------------------------- stage: report
function stageReport() {
  const { sample, pool_size } = readJson("sample.json");
  const n = sample.length;
  const rows = [];
  const load = (f) => (fs.existsSync(p(f)) ? readJson(f) : null);
  const photon = load("h1-photon.json");
  const overpass = load("h1-overpass.json");
  const h2 = load("h2.json");
  if (photon) rows.push(["H1a Photon (OSM POI)", photon.results.length, "-", photon.results.filter((r) => r.accepted).length]);
  if (overpass) {
    // Only companies the endpoint actually answered count as tried; a 429 is
    // an unanswered question, not a miss.
    const answered = overpass.results.filter((r) => !r.error);
    rows.push(["H1b Overpass (OSM POI)", answered.length, "-", answered.filter((r) => r.accepted).length]);
  }
  if (h2) {
    const withSite = h2.results.filter((r) => r.website).length;
    rows.push([
      "H2 website -> address -> Nominatim",
      h2.results.length,
      `${h2.results.filter((r) => r.addresses.length).length} (of ${withSite} with a site)`,
      h2.results.filter((r) => r.accepted).length,
    ]);
  }
  const h3 = load("h3-board.json");
  if (h3) {
    const boards = h3.results.filter((r) => r.board);
    rows.push(["H3 ATS board postal address", boards.length, `${boards.filter((r) => r.street).length} street-level`, boards.filter((r) => r.accepted).length]);
  }
  console.log(`sample ${n} of pool ${pool_size}`);
  for (const [name, tried, addrs, coords] of rows) {
    console.log(`${name}: tried ${tried}, addresses ${addrs}, coords ${coords} (${((coords / tried) * 100).toFixed(1)}%)`);
  }
  // Union: how many of the sample get a coordinate from ANY free route.
  const got = new Set();
  for (const src of [photon, overpass, h2, h3]) for (const r of src?.results ?? []) if (r.accepted) got.add(r.slug);
  console.log(`union of all free routes: ${got.size}/${n} (${((got.size / n) * 100).toFixed(1)}%)`);
}

const stage = process.argv[2];
const stages = { sample: stageSample, sites: stageSites, h3board: stageH3Board, h1photon: stageH1Photon, h1overpass: stageH1Overpass, h2: stageH2, probe: stageProbe, report: stageReport };
if (!stages[stage]) {
  console.error(`usage: node ${path.basename(process.argv[1])} <${Object.keys(stages).join("|")}>`);
  process.exit(2);
}
await stages[stage]();
console.log(`requests this run: ${JSON.stringify(counters)} (total ${totalRequests})`);
