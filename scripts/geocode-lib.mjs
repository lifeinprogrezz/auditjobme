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

/** Nominatim's top result -> { lat, lng, displayName, city, precision }, or
 *  null for an empty/malformed response (a legitimate "nothing found"). */
export function parseNominatimResult(json) {
  const hit = Array.isArray(json) ? json[0] : null;
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const addr = hit.address || {};
  const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || null;
  const precision = addr.house_number || addr.road ? "street" : city ? "locality" : "approximate";
  return { lat, lng, displayName: hit.display_name || null, city, precision };
}

/** Mapbox Geocoding v5 request URL — used only when a MAPBOX_TOKEN/
 *  MAPBOX_ACCESS_TOKEN is configured (issue #153: "prefer Mapbox with the
 *  same cache" when a key exists in env). */
export function mapboxSearchUrl(query, token) {
  const params = new URLSearchParams({ access_token: token, limit: "1" });
  return `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params.toString()}`;
}

/** Mapbox's top feature -> the same { lat, lng, displayName, city, precision }
 *  shape parseNominatimResult returns, so the caller never branches on
 *  provider after this point. */
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
  return { lat, lng, displayName: feature.place_name || null, city: city || null, precision };
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
