/**
 * Teamtailor — the official public `{site}/jobs.json` syndication feed.
 *
 * Teamtailor publishes every live opening of a career site as a JSON Feed 1.1
 * document at `/jobs.json`, served as `application/feed+json`. It is a supported
 * syndication feature, not a scrape: `robots.txt` leaves it open (it only blocks
 * /app/, /messages/, /messenger/, /jobs/internal/) and ships
 * `Content-Signal: search=yes, ai-train=no, ai-input=yes`. No auth, no key, no
 * pagination cursor (verified 2026-07-26 across 256 live tenants, largest board
 * 63 openings on one page), so it costs exactly ONE request per company per run.
 *
 * Shape, same as the Greenhouse/Lever/Ashby siblings in scripts/scrape.mjs:
 *   { company, title, url, location, remote, source, posted_at, jd_text, seniority }
 * filtered through the shared job-filters (isPM(title) && isEU(location)).
 * The feed carries the FULL description inline (`content_html`), so unlike the
 * SmartRecruiters/Workable/Workday list endpoints these rows land with jd_text.
 *
 * Boards live in scripts/boards.json under "teamtailor" and come in two flavours:
 *   { company, token }  -> https://{token}.teamtailor.com/jobs.json
 *   { company, host }   -> https://{host}/jobs.json   (custom career domain,
 *                          e.g. careers.macadam.app — very common in the EU set)
 * A bad tenant throws and scrape.mjs logs it per board, so one dead career site
 * never halts the run.
 */
import { isPM, isEU, inferSeniority, stripHtml, EU_RE } from "../job-filters.mjs";

const fetchOpts = () => ({
  signal: AbortSignal.timeout(20000), // fresh signal per call
  headers: { Accept: "application/feed+json, application/json" },
});

const toIso = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * ISO-3166 alpha-2 -> country name, for the European countries the shared EU
 * filter already speaks. Teamtailor emits country CODES ("FI", "DK", "EE") while
 * EU_RE matches country NAMES, so without this a Helsinki or Tallinn role is
 * silently dropped. This translates the code into the filter's vocabulary; it
 * deliberately does NOT widen what counts as Europe (that lives in job-filters).
 * Non-European codes are passed through untouched and fall out of the filter.
 */
export const EU_COUNTRY_NAMES = {
  AT: "Austria", BE: "Belgium", BG: "Bulgaria", CH: "Switzerland", CY: "Cyprus",
  CZ: "Czechia", DE: "Germany", DK: "Denmark", EE: "Estonia", ES: "Spain",
  FI: "Finland", FR: "France", GB: "United Kingdom", GR: "Greece", HR: "Croatia",
  HU: "Hungary", IE: "Ireland", IS: "Iceland", IT: "Italy", LI: "Liechtenstein",
  LT: "Lithuania", LU: "Luxembourg", LV: "Latvia", MT: "Malta", NL: "Netherlands",
  NO: "Norway", PL: "Poland", PT: "Portugal", RO: "Romania", SE: "Sweden",
  SI: "Slovenia", SK: "Slovakia", UK: "United Kingdom",
};

/** "Barcelona, Spain" from a schema.org Place. Null when there is no city and no country. */
export function formatPlace(place) {
  const a = (place || {}).address || {};
  const city = String(a.addressLocality || "").trim();
  const raw = String(a.addressCountry || "").trim();
  const country = EU_COUNTRY_NAMES[raw.toUpperCase()] || raw;
  // addressRegion is NOT used: tenants put internal groupings there ("EMEA" on a
  // Riyadh office, "North America" on a New York one), which would drag non-European
  // roles through the EU filter on the word alone.
  return [city, country].filter(Boolean).join(", ") || null;
}

/**
 * One location string from schema.org `jobLocation` (often an array — 12% of the
 * live corpus lists a role in several offices). Prefer the first European place so
 * a London-and-New-York role is shown, and kept, as the London one; otherwise fall
 * back to the first place. Null when the posting carries no location at all.
 */
export function pickLocation(jobLocation) {
  const places = Array.isArray(jobLocation) ? jobLocation : jobLocation ? [jobLocation] : [];
  const formatted = [...new Set(places.map(formatPlace).filter(Boolean))];
  if (!formatted.length) return null;
  return formatted.find((s) => EU_RE.test(s)) || formatted[0];
}

/** One feed item -> one `jobs` row. No filtering here; parseTeamtailorFeed does that. */
export function normalizeTeamtailorItem(item, company) {
  const it = item || {};
  const jp = it._jobposting || {};
  const title = String(it.title || jp.title || "").trim();
  const location = pickLocation(jp.jobLocation);
  const jd = stripHtml(it.content_html || jp.description || "").slice(0, 8000);
  return {
    company,
    title,
    url: it.url || "",
    location,
    remote: /remote/i.test(location || "") || /remote/i.test(title),
    source: "teamtailor",
    posted_at: toIso(it.date_published || jp.datePosted),
    jd_text: jd || null,
    seniority: inferSeniority(title),
  };
}

/** True for a document that really is a Teamtailor career-site feed. */
export function isTeamtailorFeed(feed) {
  if (!feed || typeof feed !== "object") return false;
  if (!String(feed.version || "").includes("jsonfeed.org")) return false;
  if (!Array.isArray(feed.items)) return false;
  // A board with openings proves itself through schema.org JobPosting payloads; an
  // empty board can only be recognised by its self-referential feed url.
  if (feed.items.length) return feed.items.some((i) => i && i._jobposting);
  return /\/jobs\.json$/.test(String(feed.feed_url || ""));
}

/** Pure parse: feed document -> the European Product rows it contains. */
export function parseTeamtailorFeed(feed, company) {
  const name = company || String((feed || {}).title || "").trim() || null;
  return ((feed || {}).items || [])
    .map((it) => normalizeTeamtailorItem(it, name))
    .filter((j) => j.company && j.url && isPM(j.title) && isEU(j.location));
}

export const teamtailorHost = (b) => b.host || `${b.token}.teamtailor.com`;
export const teamtailorFeedUrl = (b) => `https://${teamtailorHost(b)}/jobs.json`;

export async function fetchTeamtailor(b) {
  const res = await fetch(teamtailorFeedUrl(b), fetchOpts());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const feed = await res.json();
  if (!isTeamtailorFeed(feed)) throw new Error("not a Teamtailor jobs.json feed");
  return parseTeamtailorFeed(feed, b.company);
}
