/**
 * Personio — the public per-tenant `/xml` job feed.
 *
 * Every Personio career site syndicates its live openings as XML at
 * `https://{token}.jobs.personio.de/xml` (the `.com` mirror serves the identical
 * document — verified across 8 tenants on 2026-08-11, so `.de` is canonical
 * here). No auth, no key, no pagination (largest probed board: 325 positions on
 * one page), so it costs exactly ONE request per company per run. The sibling
 * `/search.json` endpoint exists but carries NO posting date, NO description and
 * NO url — the XML is the richer feed and the one this connector reads. The
 * JD-backfill (scripts/jd-backfill.mjs fetchPersonio) already reads the same
 * document per-row; this connector is the board-level source for it.
 *
 * Shape, same as the Greenhouse/Lever/Ashby/Teamtailor siblings:
 *   { company, title, url, location, remote, source, posted_at, jd_text, seniority }
 * filtered through the shared job-filters (isPM(title) && isEU(location)).
 * The feed carries the FULL description inline (`<jobDescriptions>` CDATA), so
 * rows land with jd_text. Posting url: `https://{host}/job/{id}` — the format
 * jd-backfill and logo-lib already recognise.
 *
 * Boards live in scripts/boards.json under "personio" as { company, token } ->
 * https://{token}.jobs.personio.de/xml. A bad tenant throws and scrape.mjs logs
 * it per board, so one dead career site never halts the run.
 *
 * Location caveat: Personio emits bare CITY names with NO country ("Hamburg",
 * "München", "Besigheim"), while the shared EU filter speaks countries plus a
 * short list of hub cities. EU_CITY_COUNTRIES below translates the European hub
 * cities (native spellings included) into "City, Country" so the filter can read
 * them — translation into the filter's vocabulary, exactly like the Teamtailor
 * connector's country-code map. It deliberately does NOT widen what counts as
 * Europe: an unmapped long-tail town ("Besigheim") passes through untouched and
 * falls out of the filter, the same way it would on any other source that
 * emitted it without a country. A "Remote"-only posting has no place at all, so
 * its location is null — honestly unknown, which the pool keeps (same stance as
 * the ats-extra null-location stubs); the `remote` flag carries the signal.
 */
import { isPM, isEU, inferSeniority, stripHtml, EU_RE } from "../job-filters.mjs";

const fetchOpts = () => ({
  signal: AbortSignal.timeout(20000), // fresh signal per call
  headers: { Accept: "application/xml, text/xml" },
});

const toIso = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * European hub city -> country, in the vocabulary EU_RE already speaks. Native
 * spellings included because Personio tenants write "München" and "Köln", not
 * "Munich" and "Cologne". Only countries the shared filter recognises are
 * listed — adding a city here whose country EU_RE cannot read would be dead
 * weight, and widening Europe itself belongs in job-filters, not here.
 */
export const EU_CITY_COUNTRIES = {
  // Germany
  munich: "Germany", "münchen": "Germany", hamburg: "Germany", berlin: "Germany",
  cologne: "Germany", "köln": "Germany", frankfurt: "Germany", stuttgart: "Germany",
  "düsseldorf": "Germany", leipzig: "Germany", dresden: "Germany", hannover: "Germany",
  "nürnberg": "Germany", nuremberg: "Germany", bremen: "Germany", dortmund: "Germany",
  essen: "Germany", bonn: "Germany", karlsruhe: "Germany", mannheim: "Germany",
  heidelberg: "Germany", aachen: "Germany", "münster": "Germany", potsdam: "Germany",
  darmstadt: "Germany", freiburg: "Germany", augsburg: "Germany", kiel: "Germany",
  // Austria + Switzerland
  vienna: "Austria", wien: "Austria", graz: "Austria", linz: "Austria",
  salzburg: "Austria", innsbruck: "Austria",
  zurich: "Switzerland", "zürich": "Switzerland", geneva: "Switzerland",
  "genève": "Switzerland", basel: "Switzerland", bern: "Switzerland",
  lausanne: "Switzerland", zug: "Switzerland",
  // Rest of the filter's Europe
  amsterdam: "Netherlands", rotterdam: "Netherlands", utrecht: "Netherlands",
  eindhoven: "Netherlands", "the hague": "Netherlands", "den haag": "Netherlands",
  paris: "France", lyon: "France", toulouse: "France", nantes: "France",
  bordeaux: "France", marseille: "France", lille: "France",
  madrid: "Spain", barcelona: "Spain", valencia: "Spain", sevilla: "Spain",
  seville: "Spain", bilbao: "Spain", "málaga": "Spain", malaga: "Spain",
  lisbon: "Portugal", lisboa: "Portugal", porto: "Portugal",
  milan: "Italy", milano: "Italy", rome: "Italy", roma: "Italy",
  turin: "Italy", torino: "Italy", bologna: "Italy",
  london: "United Kingdom", manchester: "United Kingdom", edinburgh: "United Kingdom",
  glasgow: "United Kingdom", birmingham: "United Kingdom", leeds: "United Kingdom",
  bristol: "United Kingdom", cambridge: "United Kingdom", oxford: "United Kingdom",
  cardiff: "United Kingdom",
  dublin: "Ireland", cork: "Ireland",
  brussels: "Belgium", bruxelles: "Belgium", brussel: "Belgium", "brüssel": "Belgium",
  antwerp: "Belgium", antwerpen: "Belgium", ghent: "Belgium", gent: "Belgium",
  stockholm: "Sweden", gothenburg: "Sweden", "göteborg": "Sweden", "malmö": "Sweden",
  copenhagen: "Denmark", "københavn": "Denmark", aarhus: "Denmark",
  oslo: "Norway", helsinki: "Finland", espoo: "Finland", tampere: "Finland",
  warsaw: "Poland", warszawa: "Poland", "kraków": "Poland", krakow: "Poland",
  "wrocław": "Poland", wroclaw: "Poland", "gdańsk": "Poland", gdansk: "Poland",
  prague: "Czechia", praha: "Czechia", brno: "Czechia",
  bucharest: "Romania", "bucurești": "Romania", sofia: "Bulgaria",
  athens: "Greece", tallinn: "Estonia", vilnius: "Lithuania",
};

const REMOTE_RE = /\bremote\b/i;

/**
 * One Personio `<office>` value -> a location string the shared filter can read.
 * "München" -> "München, Germany"; "Berlin (Remote)" -> "Berlin, Germany";
 * an unmapped town passes through untouched; a bare "Remote" (no city left
 * after stripping the marker) is no place at all -> null.
 */
export function formatOffice(office) {
  const city = String(office || "")
    .replace(/\s*\(remote\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!city || REMOTE_RE.test(city)) return null;
  const country = EU_CITY_COUNTRIES[city.toLowerCase()];
  return country ? `${city}, ${country}` : city;
}

/**
 * One location string from a position's offices (`<office>` + every
 * `<additionalOffices><office>`). Prefer the first European place so a
 * Remote-and-Berlin role is shown, and kept, as the Berlin one; otherwise fall
 * back to the first concrete place. Null when the posting names no place at all
 * (offices missing, or "Remote" only).
 */
export function pickLocation(offices) {
  const formatted = [...new Set((offices || []).map(formatOffice).filter(Boolean))];
  if (!formatted.length) return null;
  return formatted.find((s) => EU_RE.test(s)) || formatted[0];
}

// Minimal XML entity decoder for the handful Personio's feed actually emits in
// text nodes (titles like "Procurement &amp; Portfolio Management").
const decodeEntities = (s) =>
  String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");

const tag = (block, name) => {
  const m = String(block || "").match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].trim() : "";
};

/**
 * One `<position>` block -> its fields. Regex-parsed on purpose: the feed is
 * machine-generated, flat and stable (same approach jd-backfill.mjs has used in
 * production since #68), so a real XML parser would be the first runtime dep of
 * the whole scrape for no added safety. The nested `<jobDescriptions>` section
 * is cut out FIRST so its inner `<name>` tags (section headings) can never be
 * mistaken for the position title.
 */
export function parsePosition(block) {
  const b = String(block || "");
  const descM = b.match(/<jobDescriptions>([\s\S]*?)<\/jobDescriptions>/i);
  const rest = descM ? b.replace(descM[0], "") : b;
  const offices = [tag(rest, "office")];
  const additional = rest.match(/<additionalOffices>([\s\S]*?)<\/additionalOffices>/i);
  if (additional) {
    for (const m of additional[1].matchAll(/<office>([\s\S]*?)<\/office>/gi)) {
      offices.push(m[1].trim());
    }
  }
  return {
    id: tag(rest, "id"),
    name: decodeEntities(tag(rest, "name")),
    subcompany: decodeEntities(tag(rest, "subcompany")),
    offices: offices.map(decodeEntities).filter(Boolean),
    createdAt: tag(rest, "createdAt"),
    descriptions: descM ? descM[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "") : "",
  };
}

/** One parsed position -> one `jobs` row. No filtering here; parsePersonioXml does that. */
export function normalizePersonioPosition(pos, company, host) {
  const p = pos || {};
  const location = pickLocation(p.offices);
  const jd = stripHtml(p.descriptions || "").slice(0, 8000);
  return {
    // The feed has no board-level name; <subcompany> (the hiring legal entity)
    // is the closest thing when boards.json carries no display name.
    company: company || p.subcompany || null,
    title: p.name || "",
    url: p.id ? `https://${host}/job/${p.id}` : "",
    location,
    remote:
      (p.offices || []).some((o) => REMOTE_RE.test(o)) || REMOTE_RE.test(p.name || ""),
    source: "personio",
    posted_at: toIso(p.createdAt),
    jd_text: jd || null,
    seniority: inferSeniority(p.name),
  };
}

/** True for a document that really is a Personio `/xml` feed (root `<workzag-jobs>`). */
export function isPersonioFeed(xml) {
  return /<workzag-jobs[\s>]/i.test(String(xml || ""));
}

/** Count of `<position>` blocks — the probe's "openings" number (sync-boards.mjs). */
export function countPersonioPositions(xml) {
  return (String(xml || "").match(/<position>/gi) || []).length;
}

/** Pure parse: feed document -> the European Product rows it contains. */
export function parsePersonioXml(xml, company, host) {
  const rows = [];
  for (const m of String(xml || "").matchAll(/<position>([\s\S]*?)<\/position>/gi)) {
    rows.push(normalizePersonioPosition(parsePosition(m[1]), company, host));
  }
  return rows.filter((j) => j.company && j.url && isPM(j.title) && isEU(j.location));
}

export const personioHost = (b) => b.host || `${b.token}.jobs.personio.de`;
export const personioFeedUrl = (b) => `https://${personioHost(b)}/xml`;

export async function fetchPersonio(b) {
  const res = await fetch(personioFeedUrl(b), fetchOpts());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (!isPersonioFeed(xml)) throw new Error("not a Personio /xml feed");
  return parsePersonioXml(xml, b.company, personioHost(b));
}
