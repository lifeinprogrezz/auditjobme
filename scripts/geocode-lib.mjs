// Pure helpers for scripts/geocode-companies.mjs (issue #153, item B2). No
// network, no DB -- pinned by src/test/geocode-lib.test.ts.

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km between two [lng, lat] points. */
export function haversineKm([lng1, lat1], [lng2, lat2]) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** How far a company_offices result may sit from the city-centroid query
 *  before it is discarded (issue #153 acceptance criteria). */
export const MAX_OFFICE_TO_CITY_KM = 50;

/** company_offices.city_key from a resolved city name — ASCII-folded, spaces
 *  collapsed, matching the style already live in the table (`novi sad`,
 *  `kobenhavn`) rather than underscore-joined (that convention belongs to
 *  companies.slug, a different column with a different job). */
export function cityKeyFor(cityName) {
  return String(cityName || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The Nominatim /search request URL for one free-text query. jsonv2 +
 *  addressdetails so the response carries a city/town breakdown we can
 *  re-query as its own (heavily cache-shared) centroid lookup. */
export function nominatimSearchUrl(query) {
  const params = new URLSearchParams({ q: query, format: "jsonv2", addressdetails: "1", limit: "1" });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

/** Nominatim's top result -> { lat, lng, displayName, city, precision, name,
 *  class }, or null for an empty/malformed response (a legitimate "nothing
 *  found"). `name` and `class` are the OSM feature's own name and primary tag
 *  namespace -- isTrustworthyOffice below is what actually gates on them;
 *  this function just carries them through. `class` reads jsonv2's top-level
 *  `category` field (verified live: format=jsonv2 -- the format this script
 *  requests -- never sends a top-level `class` key; that was Nominatim's
 *  legacy non-jsonv2 shape). `hit.class` stays as a fallback in case a caller
 *  ever points this at that legacy shape instead. */
export function parseNominatimResult(json) {
  const hit = Array.isArray(json) ? json[0] : null;
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const addr = hit.address || {};
  const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || null;
  const precision = addr.house_number || addr.road ? "street" : city ? "locality" : "approximate";
  return {
    lat,
    lng,
    displayName: hit.display_name || null,
    city,
    precision,
    name: hit.name || null,
    class: hit.category ?? hit.class ?? null,
  };
}

/** Mapbox Geocoding v5 request URL — used only when a MAPBOX_TOKEN/
 *  MAPBOX_ACCESS_TOKEN is configured (issue #153: "prefer Mapbox with the
 *  same cache" when a key exists in env). */
export function mapboxSearchUrl(query, token) {
  const params = new URLSearchParams({ access_token: token, limit: "1" });
  return `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params.toString()}`;
}

/** Mapbox's top feature -> the same { lat, lng, displayName, city, precision,
 *  name, class } shape parseNominatimResult returns, so the caller never
 *  branches on provider after this point. `class` is a Mapbox place_type
 *  approximation of Nominatim's OSM class: "poi" for an actual point of
 *  interest, else the feature's own most-specific place_type. */
export function parseMapboxResult(json) {
  const feature = json?.features?.[0];
  const center = feature?.center;
  if (!Array.isArray(center) || center.length < 2) return null;
  const [lng, lat] = center;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const placeType = feature.place_type || [];
  const placeCtx = (feature.context || []).find((c) => typeof c?.id === "string" && c.id.startsWith("place."));
  const city = placeType.includes("place") ? feature.text : (placeCtx ? placeCtx.text : null);
  const precision = placeType.includes("address") ? "street" : city ? "locality" : "approximate";
  return {
    lat,
    lng,
    displayName: feature.place_name || null,
    city: city || null,
    precision,
    name: feature.text || null,
    class: placeType.includes("poi") ? "poi" : placeType[0] || null,
  };
}

/** Rate limiting (Nominatim: 1 req/s). Given when the last ACTUAL network call
 *  fired, how many ms to wait before the next one — 0 if this is the first
 *  call, or enough time has already passed. */
export const MIN_REQUEST_INTERVAL_MS = 1000;
export function waitMsFor(lastRequestAt, now = Date.now()) {
  if (lastRequestAt == null) return 0;
  return Math.max(0, MIN_REQUEST_INTERVAL_MS - (now - lastRequestAt));
}

/** Postgres "undefined_table" — geocode_cache migration not applied yet
 *  (issue #153: the script must degrade gracefully, not crash). */
export function isMissingTableError(error) {
  if (!error) return false;
  return error.code === "42P01" || /relation .* does not exist/i.test(error.message || "");
}

/** Composite key for a (company_slug, city_key) pair -- how a pre-loaded Set
 *  of existing company_offices rows is checked against a resolved candidate
 *  (issue #153 fix round 1, blocker 2): the geocode-companies.mjs upsert
 *  previously had no existence check, so a first run silently replaced
 *  street-precision hand-curated coordinates with unverified Nominatim
 *  answers for the same (company, city) pair. */
export function officeKey(companySlug, cityKey) {
  return `${companySlug} ${cityKey}`;
}

/** Whether a resolved (company_slug, city_key) candidate must be skipped
 *  because a company_offices row -- hand-curated seed data, or written by an
 *  earlier run -- already exists for that exact pair. Pure: existingKeys is
 *  the Set pre-loaded once from the DB before the geocode loop runs. */
export function shouldSkipExistingOffice(existingKeys, companySlug, cityKey) {
  return existingKeys.has(officeKey(companySlug, cityKey));
}

/** OSM primary-tag namespaces that describe an AREA or a LINE, never a single
 *  company address: "place" (a village/town/city node), "highway" (a road),
 *  "boundary" (an administrative polygon). A hit tagged with one of these is
 *  never a trustworthy office, no matter how its precision/name score. */
const REJECT_OFFICE_CLASSES = new Set(["place", "highway", "boundary"]);

function normalizeForNameMatch(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The name a geocode result would carry if it had none of its own -- the
 *  first comma-separated segment of the full address string, which is where
 *  a named POI's own name sits in both providers' display strings. */
function firstDisplayNameComponent(displayName) {
  if (!displayName) return null;
  const first = String(displayName).split(",")[0].trim();
  return first || null;
}

/**
 * Whether a geocoded ADDRESS result is trustworthy enough to become a
 * company_offices row (issue #153 fix round 2, blocker 2). Two failure
 * shapes measured on live prod tuples, same query shape as this script:
 *   - "5U AI, Munich" -> Nominatim's top hit is the village Baierbrunn
 *     (precision "locality", class "place"): an area centroid, not an
 *     address -- and the city-distance check alone can't catch it, because
 *     re-geocoding that SAME village name lands 0.0km from itself.
 *   - "Pigment, London" -> a street literally named "Pigment Square"
 *     (precision "street", class "highway"): street precision alone isn't
 *     enough -- the hit has to actually BE the company, not just share a
 *     word with a road name.
 * Gate, both required: (1) precision === "street" -- an actual address, not
 * an area centroid, and its OSM class isn't one of the area/line namespaces
 * above; (2) the hit's own name (jsonv2 `name`, falling back to the first
 * display_name segment) matches the company name once both are folded to
 * bare lowercase words. Doctolib and Adobe -- real OSM POIs tagged with the
 * company's own name at street precision -- pass this gate; a village or a
 * same-word street does not. Pure: no network, no DB.
 */
export function isTrustworthyOffice(result, companyName) {
  if (!result || result.precision !== "street") return false;
  if (result.class && REJECT_OFFICE_CLASSES.has(result.class)) return false;
  const officeName = result.name || firstDisplayNameComponent(result.displayName);
  if (!officeName) return false;
  const a = normalizeForNameMatch(officeName);
  const b = normalizeForNameMatch(companyName);
  return a.length > 0 && a === b;
}
