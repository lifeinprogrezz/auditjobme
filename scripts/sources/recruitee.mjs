/**
 * Recruitee — the public per-tenant `/api/offers/` career-site endpoint.
 *
 * Every Recruitee career site serves its live openings as JSON at
 * `https://{token}.recruitee.com/api/offers/`, and a tenant on a custom career
 * domain serves the identical document at `https://{host}/api/offers/`
 * (careers.tether.io returned the same 198 offers as tether.recruitee.com,
 * verified 2026-08-19). No auth, no key, no pagination — `?page`, `?offset` and
 * `?limit` are ignored, and the largest probed board answered its full 198
 * offers in one response — so it costs exactly ONE request per company per run.
 * Probed across 44 hosts / 661 offers on 2026-08-19: `{"offers":[…]}` was the
 * whole top-level document every time, `status` was "published" on all 661, and
 * no offer carried a `close_at`, so the endpoint serves only live openings.
 * scripts/jd-backfill.mjs (fetchRecruitee) already reads the same document
 * per-row; this connector is the board-level source for it.
 *
 * Shape, same as the Greenhouse/Lever/Ashby/Teamtailor/Personio siblings:
 *   { company, title, url, location, remote, source, posted_at, jd_text, seniority }
 * filtered through the shared job-filters (isInScope(title) && isEU(location))
 * — the five role_family verticals since #34, not PM-only. The row also carries
 * role_family (#34 contract) from the SAME classifier scrape.mjs stamps rows
 * with centrally, so the two can never disagree. The document carries the full
 * body inline (`description` + `requirements`), so rows land with jd_text.
 *
 * Boards live in scripts/boards.json under "recruitee" in the two flavours the
 * Teamtailor connector already uses:
 *   { company, token }  -> https://{token}.recruitee.com/api/offers/
 *   { company, host }   -> https://{host}/api/offers/   (custom career domain,
 *                          e.g. careers.tether.io)
 * An unknown tenant answers 404 `{"error":"Not Found"}` and a renamed one 302s to
 * its new token (fetch follows the redirect). A bad tenant throws and scrape.mjs
 * logs it per board, so one dead career site never halts the run. Rows are
 * deduped centrally in scrape.mjs on `url`; `id` and `careers_url` are the stable
 * keys here (a slug is unique per tenant only).
 *
 * Location caveat — the one real trap. The top-level `location` and `country`
 * strings are rendered in the TENANT's career-site language ("Berlin, Berlin,
 * Allemagne" on a German office; `country`: "Nederland") and are REPLACED by a
 * placeholder when the offer is remote ("Remote job", "Poste à distance",
 * "Werken op afstand"), which hides the office behind it. Over the 661-offer
 * corpus, feeding the raw string to the shared filter kept 77 of 144 genuine
 * European rows — it dropped 47% of them. `country_code` is a correct ISO
 * alpha-2 on all 661, so this connector builds "City, Country" from the code
 * instead, through the same EU_COUNTRY_NAMES map the Teamtailor connector
 * exports. That is translation into the filter's vocabulary; it deliberately
 * does NOT widen what counts as Europe (an unmapped code passes through
 * untouched and falls out of isEU, exactly as on Teamtailor).
 */
import {
  isInScope,
  isEU,
  inferSeniority,
  stripHtml,
  classifyRoleFamily,
  EU_RE,
} from "../job-filters.mjs";
import { EU_COUNTRY_NAMES } from "./teamtailor.mjs";
import { pfetch } from "./_proxy.mjs";

const fetchOpts = () => ({
  signal: AbortSignal.timeout(20000), // fresh signal per call
  headers: { Accept: "application/json" },
});

const toIso = (v) => {
  if (!v) return null;
  const d = new Date(v); // "2026-08-12 09:48:05 UTC" parses natively
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * "Barcelona, Spain" from a city plus a country CODE. The code wins over the
 * tenant-rendered country name, which is why a Berlin office filed as
 * "Allemagne" still reads as Germany. An unmapped code falls back to whatever
 * country name the offer carried. Null when there is no city and no country.
 */
export function formatPlace(city, countryCode, fallbackCountry) {
  const name = String(city || "").trim();
  const code = String(countryCode || "").trim().toUpperCase();
  const country = EU_COUNTRY_NAMES[code] || String(fallbackCountry || "").trim();
  return [name, country].filter(Boolean).join(", ") || null;
}

/**
 * One location string for an offer, from its own city plus every entry of
 * `locations[]` (up to 28 on one posting). Prefer the first European place so a
 * worldwide-remote role offered in Abu Dhabi, Warsaw and London is shown, and
 * kept, as the Warsaw one; otherwise fall back to the first place. Null when the
 * offer names no place at all. The top-level `location` string is never read —
 * see the localization note in the header.
 */
export function pickLocation(offer) {
  const o = offer || {};
  const places = Array.isArray(o.locations) ? o.locations : [];
  const candidates = [
    ...new Set(
      [
        formatPlace(o.city, o.country_code, o.country),
        ...places.map((l) => formatPlace((l || {}).city || (l || {}).name, (l || {}).country_code, (l || {}).country)),
      ].filter(Boolean),
    ),
  ];
  if (!candidates.length) return null;
  return candidates.find((s) => EU_RE.test(s)) || candidates[0];
}

/** One offer -> one `jobs` row. No filtering here; parseRecruiteeOffers does that. */
export function normalizeRecruiteeOffer(offer, company) {
  const o = offer || {};
  const title = String(o.title || "").trim();
  const location = pickLocation(o);
  // BOTH bodies: `description` is the company/role pitch, `requirements` the
  // must-haves list, and requirements is frequently the LONGER of the two (a
  // seQura row: 2,747 vs 8,124 chars). Description alone would throw away the
  // half a JD-vs-CV rubric scores against. requirements is null on ~3.5% of
  // offers, hence the filter.
  const jd = stripHtml([o.description, o.requirements].filter(Boolean).join("\n\n")).slice(0, 8000);
  return {
    // company_name is the LEGAL entity on some tenants ("Tether Operations
    // Limited", "epilot GmbH"), so the boards.json display name wins.
    company: company || o.company_name || null,
    title,
    // Used as-is, never rebuilt from the slug: on a custom career domain this is
    // the only field carrying the real host, and it is the /o/{slug} form
    // jd-backfill.mjs and logo-lib already recognise.
    url: o.careers_url || "",
    location,
    // Only `remote` is read. The sibling booleans exist but are not a reliable
    // triple — one epilot offer had remote, hybrid AND on_site all true.
    remote: Boolean(o.remote) || /remote/i.test(location || "") || /remote/i.test(title),
    source: "recruitee",
    posted_at: toIso(o.published_at || o.created_at),
    jd_text: jd || null,
    seniority: inferSeniority(title),
    // Title inference, one rule across sources. The offer's own
    // `experience_code` is a free tenant choice and is deliberately ignored.
    role_family: classifyRoleFamily(title),
  };
}

/**
 * True when a board is hosting this offer on ANOTHER company's behalf.
 *
 * Some tenants are talent boards, not employers: jobsatlanticvc.recruitee.com
 * files 13 of its 14 offers under department "Portfolio Company" and advertises
 * its portfolio's roles. Its `company_name` reads "atlantic.vc" on every one, so
 * the real employer appears NOWHERE in the payload except inside the title
 * ("... @ DeepTech Scale-Up"). There is nothing trustworthy to re-attribute to,
 * so these are dropped rather than shipped under the board owner. That is the
 * bug #102 fixed for Getro, where Beekeeper rows carried LumApps postings: a
 * missing row is recoverable, a wrong employer poisons the tracker and the
 * outreach built on it.
 */
export function isForeignListing(offer) {
  return /portfolio/i.test(String((offer || {}).department || ""));
}

/** True for a document that really is a Recruitee offers response. */
export function isRecruiteeFeed(doc) {
  // An empty board is a legitimate 200 `{"offers":[]}` (bizzy, tiboenergy,
  // chapter), so a non-empty check would wrongly reject live tenants.
  return Boolean(doc) && typeof doc === "object" && Array.isArray(doc.offers);
}

/** Pure parse: offers document -> the European in-scope rows it contains. */
export function parseRecruiteeOffers(doc, company) {
  const offers = Array.isArray((doc || {}).offers) ? doc.offers : [];
  return offers
    // Belt and braces: the endpoint served only published offers across the
    // whole probe, so this can only ever drop something that should not ship.
    .filter((o) => o && (o.status || "published") === "published")
    // Never ship someone else's role under this board's name (see isForeignListing).
    .filter((o) => !isForeignListing(o))
    .map((o) => normalizeRecruiteeOffer(o, company))
    .filter((j) => j.company && j.url && isInScope(j.title) && isEU(j.location));
}

export const recruiteeHost = (b) => b.host || `${b.token}.recruitee.com`;
export const recruiteeFeedUrl = (b) => `https://${recruiteeHost(b)}/api/offers/`;

export async function fetchRecruitee(b) {
  const res = await pfetch(recruiteeFeedUrl(b), fetchOpts()); // follows the rename 302
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = await res.json();
  if (!isRecruiteeFeed(doc)) throw new Error("not a Recruitee offers document");
  return parseRecruiteeOffers(doc, b.company);
}
