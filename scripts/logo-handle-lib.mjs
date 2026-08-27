/**
 * ATS-handle logo derivation (issue #153, logo-coverage defect). The pure half:
 * no network, no DB. scripts/logo-backfill.mjs owns the probes and the writes.
 *
 * WHY THIS EXISTS. `resolveLogoDomain` (scripts/logo-lib.mjs) derives a domain
 * only from a URL the company owns, and returns null for every hosted-ATS host,
 * because a wrong domain renders a WRONG logo. That leaves 571 of the 1,209
 * companies on the map with no logo domain: their only URL on file is an ATS
 * apply link. Measured on the 2026-08-26 dataplane artifact, 517 of those 571
 * carry a clean company handle in that link (jobs.ashbyhq.com/1password,
 * adobe.wd5.myworkdayjobs.com, boards.greenhouse.io/aiven36).
 *
 * The handle is a GUESS at a domain, so nothing here is trusted on its own.
 * Four gates run before a domain is ever written:
 *   1. the handle must look like the company's own name (handleMatchesName) --
 *      kills "Semana | personio | deskbird" and "SeedLegals | workable | jobs",
 *      both real rows in the pool today;
 *   2. the candidate must not be a hosted-ATS/platform host (checked by the
 *      caller through logo-lib's domainFromUrl, so one host list stays canonical);
 *   3. the candidate must ANSWER on the network (scripts/logo-backfill.mjs),
 *      on itself, and not from a for-sale lander (siteProbeVerdict, isParkingBody).
 *      Only a read of the page counts: an icon probe was tried and removed, see
 *      the note where iconProbeVerdict used to be;
 *   4. the page that answers must name the company (pageNamesCompany) AND must
 *      not be a holding page (isHoldingPage) -- both, because a live site on a
 *      name-shaped domain can still be somebody else's, and a parked or
 *      reserved one titles itself with the domain, which carries the name;
 *   5. and exactly ONE of the company's candidates may pass, or nothing is
 *      written (the caller's runPlan). Granola, Faculty and Axelera all have a
 *      .com owned by a different business AND a .ai that is theirs, so "first
 *      one that answers" picked the wrong site for all three. When two do pass,
 *      one tie-break decides: the company's own site links the board the job
 *      came from (bodyLinksAtsTenant). No winner there means no logo.
 *
 * NOTHING here runs in the browser. The client-side name guess was removed on
 * purpose (PR #164): Chromium logs every failed <img> load from its resource
 * loader and no handler can silence it, 143 console errors in one walk.
 *
 * Unit tests: src/test/logo-handle-lib.test.ts (vitest, offline).
 */
import { registrableDomain } from "./logo-lib.mjs";

// ── URL → { ats, handle } ────────────────────────────────────────────────────
// Host shapes are read from the scrapers that build these URLs, never invented:
// scripts/scrape.mjs (greenhouse/lever/ashby), scripts/sources/ats-extra.mjs
// (workable/smartrecruiters), sources/personio.mjs, sources/recruitee.mjs,
// sources/teamtailor.mjs, sources/joincom.mjs, and scripts/jd-backfill-lib.mjs
// atsKindOf for the same host regexes the JD backfill routes on.

/** ATSes that give each tenant its own subdomain: the FIRST label is the handle. */
const SUBDOMAIN_ATS = [
  ["recruitee.com", "recruitee"], // {handle}.recruitee.com/o/{slug}
  ["jobs.personio.de", "personio"], // {handle}.jobs.personio.de/job/{id}
  ["jobs.personio.com", "personio"],
  ["teamtailor.com", "teamtailor"], // {handle}.teamtailor.com/jobs/{id}-{slug}
  ["bamboohr.com", "bamboohr"], // {handle}.bamboohr.com/careers/{id}
  ["factorialhr.com", "factorial"], // {handle}.factorialhr.com/job_posting/{slug}
  ["factorialhr.es", "factorial"],
  ["welcomekit.co", "welcomekit"], // {handle}.welcomekit.co/jobs/{slug}
  ["freshteam.com", "freshteam"], // {handle}.freshteam.com/jobs/{id}
  ["keka.com", "keka"], // {handle}.keka.com/careers/jobdetails/{id}
  ["viterbit.site", "viterbit"], // {handle}.viterbit.site/{slug}
  ["odoo.com", "odoo"], // {handle}.odoo.com/jobs/{slug}
  ["careers.hibob.com", "hibob"], // {handle}.careers.hibob.com/jobs/{id}
  ["careers.haileyhr.app", "haileyhr"], // {handle}.careers.haileyhr.app/{lang}/job/{id}
  ["myworkdaysite.com", "workday"], // {handle}.myworkdaysite.com/...
];

/** ATSes that put the tenant in the path. `seg` is the 0-based path segment,
 *  `prefix` (when set) is the segment that must sit in front of it. */
const PATH_ATS = [
  { host: /(^|\.)greenhouse\.io$/, ats: "greenhouse", seg: 0 }, // boards|job-boards.greenhouse.io/{handle}/jobs/{id}
  { host: /(^|\.)lever\.co$/, ats: "lever", seg: 0 }, // jobs.lever.co/{handle}/{id}
  { host: /(^|\.)ashbyhq\.com$/, ats: "ashby", seg: 0 }, // jobs.ashbyhq.com/{handle}/{id}
  { host: /(^|\.)workable\.com$/, ats: "workable", seg: 0 }, // apply.workable.com/{handle}/j/{code}/
  { host: /(^|\.)smartrecruiters\.com$/, ats: "smartrecruiters", seg: 0 }, // jobs.smartrecruiters.com/{handle}/{id}
  { host: /(^|\.)join\.com$/, ats: "join", seg: 1, prefix: "companies" }, // join.com/companies/{handle}/{id}
  { host: /(^|\.)dover\.com$/, ats: "dover", seg: 1, prefix: "apply" }, // app.dover.com/apply/{Company Name}/{id}/
  { host: /(^|\.)rippling\.com$/, ats: "rippling", seg: 0 }, // ats.rippling.com/{handle}/jobs/{id}
  { host: /(^|\.)gem\.com$/, ats: "gem", seg: 0 }, // jobs.gem.com/{handle}/{id}
  { host: /(^|\.)screenloop\.com$/, ats: "screenloop", seg: 1, prefix: "careers" }, // app.screenloop.com/careers/{handle}/...
  { host: /(^|\.)comeet\.com$/, ats: "comeet", seg: 1, prefix: "jobs" }, // comeet.com/jobs/{handle}/{id}
  { host: /(^|\.)revolutpeople\.com$/, ats: "revolut-people", seg: 0 }, // revolutpeople.com/{handle}/public/careers/...
];

/** Workday's tenant sits in front of the data-center label: {handle}.wd5.myworkdayjobs.com */
const WORKDAY_HOST_RE = /^([^.]+)\.wd\d+\.myworkdayjobs\.com$/;

function decodeSegment(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * The ATS tenant handle carried by ONE apply URL, or null when the URL belongs
 * to no ATS this knows, or carries no tenant. The handle is returned RAW (as it
 * appears in the URL); normalizeHandle below is what cleans it.
 */
export function atsHandleFromUrl(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();

  for (const [suffix, ats] of SUBDOMAIN_ATS) {
    if (host.endsWith(`.${suffix}`)) {
      const handle = host.slice(0, host.length - suffix.length - 1).split(".")[0];
      return handle ? { ats, handle } : null;
    }
  }
  const workday = host.match(WORKDAY_HOST_RE);
  if (workday) return { ats: "workday", handle: workday[1] };

  const segs = u.pathname.split("/").filter(Boolean).map(decodeSegment);
  for (const rule of PATH_ATS) {
    if (!rule.host.test(host)) continue;
    if (rule.prefix && segs[0] !== rule.prefix) continue;
    // Greenhouse's embedded form carries the tenant in the query, and its first
    // path segment is the board's own word: /embed/job_app?for={token}&token={id}
    // (the same shape jd-backfill-lib's greenhouseRef reads). The query wins.
    const embedded = rule.ats === "greenhouse" ? u.searchParams.get("for") : null;
    if (embedded) return { ats: rule.ats, handle: embedded };
    const handle = segs[rule.seg];
    return handle ? { ats: rule.ats, handle } : null;
  }
  return null;
}

/**
 * The first handle any of a company's apply URLs yields. Bounded by the caller,
 * which passes only the first few live-job URLs per company.
 */
export function handleFromApplyUrls(urls) {
  for (const url of urls || []) {
    const hit = atsHandleFromUrl(url);
    if (hit) return hit;
  }
  return null;
}

// ── Handle → candidate domains ───────────────────────────────────────────────

/** Handles that name the board, not a company. A domain built from one of these
 *  belongs to someone else: "SeedLegals | workable | jobs" and
 *  "Quivo | join | join" are both live rows in the pool today. */
const GENERIC_HANDLES = new Set([
  "jobs",
  "job",
  "career",
  "careers",
  "apply",
  "applications",
  "company",
  "companies",
  "board",
  "boards",
  "embed",
  "hiring",
  "hire",
  "join",
  "talent",
  "team",
  "work",
  "recruiting",
  "recruitment",
  "vacancies",
  "positions",
  "openings",
  "external",
  "public",
  "en",
  "us",
  "uk",
  "eu",
]);

/** Suffixes join.com glues onto the tenant slug: its path segment is the
 *  company's domain with the dots removed ("spotixxcom" for spotixx.com --
 *  scripts/sources/joincom.mjs joinJobUrl says so). */
const GLUED_TLDS = [
  "com",
  "io",
  "ai",
  "co",
  "de",
  "fr",
  "es",
  "eu",
  "net",
  "org",
  "app",
  "dev",
  "nl",
  "se",
  "dk",
  "fi",
  "ch",
  "at",
  "be",
  "it",
  "pt",
];

/** Top-level domains a handle's LAST dash-separated word may really be, with the
 *  dot written as a dash ("5u-ai" for 5u.ai). Kept short on purpose: a common
 *  English word like "co" or "de" as a last word is far more often a word. */
const DOTTABLE_TLDS = new Set(["ai", "io", "app", "dev", "xyz"]);

/** Trailing legal-entity words, dropped before a name is compared to a handle. */
const LEGAL_SUFFIXES = new Set([
  "gmbh",
  "ab",
  "bv",
  "sl",
  "sas",
  "ltd",
  "inc",
  "se",
  "ag",
  "nv",
  "aps",
  "oy",
  "as",
  "plc",
  "llc",
  "limited",
  "srl",
  "sa",
  "spa",
  "kg",
  "ug",
  "oyj",
]);

/** Lowercase, fold accents, keep letters/digits/dashes. Percent-escapes are
 *  decoded first: some company names reach the pool still URL-encoded
 *  ("Protex%20AI", "Tools%20for%20Humanity"). */
function fold(value) {
  let s = String(value ?? "");
  if (s.includes("%")) s = decodeSegment(s);
  // HTML entities are dropped, not spelled out: a title reading "Alice &amp; Bob"
  // folded to "aliceampbob" and stopped matching the company "Alice Bob"
  // (measured 2026-08-27, it cost Alice & Bob its real domain).
  if (s.includes("&")) s = s.replace(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi, " ");
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** A handle cleaned into something that can sit in a hostname, or null when it
 *  is too short, all digits, or the name of the board rather than a company. */
export function normalizeHandle(handle) {
  const cleaned = fold(handle)
    .replace(/[\s_.]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length < 3) return null;
  if (/^[0-9-]+$/.test(cleaned)) return null;
  if (GENERIC_HANDLES.has(cleaned)) return null;
  return cleaned;
}

/** A name folded to bare alphanumerics, with a trailing legal suffix dropped. */
export function normalizeName(name) {
  const words = fold(name)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join("");
}

/**
 * Does this handle plausibly name this company? Equal after folding, or one is
 * a prefix of the other with at least 4 characters in common. Deliberately
 * strict: it rejects "Ivy | ashby | get-ivy" (a real company, real handle) to
 * also reject "Atlas Metrics | rippling | novata" and "Semana | personio |
 * deskbird" (two companies whose apply URL points at a DIFFERENT tenant). A
 * missed logo is a coloured initial; a wrong one is another company's mark.
 */
export function handleMatchesName(handle, name) {
  const h = normalizeHandle(handle);
  const n = normalizeName(name);
  if (!h || !n) return false;
  const flat = h.replace(/-/g, "");
  if (flat === n) return true;
  if (flat.length >= 4 && n.startsWith(flat)) return true;
  if (n.length >= 4 && flat.startsWith(n)) return true;
  return false;
}

/**
 * Domains worth probing for one handle, best guess first and capped. A company
 * gets at most `max` network probes out of this, and the first that validates
 * wins, so the usual cost is one request.
 */
export function candidateDomains(handle, ats, { max = 4 } = {}) {
  const h = normalizeHandle(handle);
  if (!h) return [];
  const out = [];
  const push = (d) => {
    if (d && !out.includes(d)) out.push(d);
  };

  // join.com hands back the domain with its dots removed, so undo that first:
  // it is the one ATS whose handle IS a domain, not a guess at one.
  if (ats === "join" && !h.includes("-")) {
    for (const tld of GLUED_TLDS) {
      if (!h.endsWith(tld)) continue;
      const base = h.slice(0, -tld.length);
      if (base.length >= 3) push(`${base}.${tld}`);
      break;
    }
  }

  push(`${h}.com`);

  // A handle whose last word IS a top-level domain is usually a domain with the
  // dot turned into a dash: 5U AI's Dover segment reads "5U AI" and the company
  // lives at 5u.ai, wonka-ai at wonka.ai. Tried early, because when it applies
  // it is a better guess than the plain .com.
  const tail = h.split("-").pop();
  if (h.includes("-") && DOTTABLE_TLDS.has(tail)) {
    const base = h.slice(0, -(tail.length + 1));
    if (base.length >= 2) push(`${base}.${tail}`);
  }

  if (h.includes("-")) push(`${h.replace(/-/g, "")}.com`);
  push(`${h}.io`);
  push(`${h}.ai`);
  return out.slice(0, max);
}

// ── Network responses → a verdict (still pure: the caller does the fetching) ──

/** Domain-parking and for-sale hosts. A redirect that lands on one of these
 *  means the candidate is registered but belongs to nobody we want a logo from. */
const PARKING_HOSTS = new Set([
  "sedoparking.com",
  "sedo.com",
  "parkingcrew.net",
  "above.com",
  "bodis.com",
  "afternic.com",
  "dan.com",
  "hugedomains.com",
  "undeveloped.com",
  "godaddy.com",
  "squadhelp.com",
  "atom.com",
  "brandbucket.com",
  "buydomains.com",
  "domainmarket.com",
  "sav.com",
  "epik.com",
  "namecheap.com",
]);

/**
 * Verdict for a root-URL probe of one candidate. `finalUrl` is where the
 * request ENDED, after redirects.
 *   "ok"      the candidate answers on its own registrable domain
 *   "parked"  it answers, but on a domain-parking host
 *   "offsite" it redirects to a different company or platform
 *   "dead"    it does not answer
 * Only "ok" may be written. Anything else is a reject, and the caller may still
 * try the icon probe below ONLY for "dead" (a site that blocks HEAD can still
 * serve its favicon); "parked" and "offsite" end the candidate outright.
 */
export function siteProbeVerdict({ status, finalUrl, candidate }) {
  if (!(status >= 200 && status < 400)) return "dead";
  let host;
  try {
    host = new URL(String(finalUrl)).hostname.toLowerCase();
  } catch {
    return "dead";
  }
  const landed = registrableDomain(host);
  if (PARKING_HOSTS.has(landed)) return "parked";
  return landed === registrableDomain(candidate) ? "ok" : "offsite";
}

/** Wording that only ever appears on a for-sale or parking page. Checked
 *  against the first few KB of the body, because a parked domain often serves
 *  its lander from the candidate's OWN host, where the redirect rule above
 *  sees nothing wrong. */
const PARKING_MARKERS = [
  "domain is for sale",
  "this domain is for sale",
  "buy this domain",
  "the domain name is for sale",
  "domain for sale",
  "parkingcrew",
  "sedoparking",
  "hugedomains",
  "afternic",
  "domain parking",
  "dominio en venta",
  "domaine à vendre",
];

export function isParkingBody(body) {
  const text = String(body || "")
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (PARKING_MARKERS.some((m) => text.includes(m))) return true;
  // "AIcoustics.com is for sale | DNX.com" -- the broker names the domain
  // rather than saying "this domain", so match that shape too.
  if (/[a-z0-9-]+\.[a-z]{2,6} is for sale/.test(text)) return true;
  // The commonest lander ships no words at all: a 114-byte stub whose only
  // content is a script hop to its own landing path. Measured live on
  // 2026-08-27, annamoney.ai and ankar.com both answered exactly this, and both
  // would otherwise have passed as a real site.
  return text.length < 400 && /location\.(href|replace)/.test(text) && /\/(lander|park|default)\b/.test(text);
}

/** Every name the page gives ITSELF: title, og:site_name, og:title,
 *  application-name, twitter:title. Read once, used by both gates below. */
function selfNames(head) {
  const html = String(head || "");
  return [
    (html.match(/<title[^>]*>([^<]*)/i) || [])[1],
    ...[...html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:site_name|og:title|application-name|twitter:title)["'][^>]*>/gi)].map(
      (m) => (m[0].match(/content=["']([^"']*)/i) || [])[1],
    ),
  ].filter(Boolean);
}

/**
 * Does the page that answered actually belong to this company? The candidate
 * domain is built from a handle, so a live site on it can still be somebody
 * else's: measured live on 2026-08-27, "Two" would have taken two.com and
 * "Scope" scope.com. The page's own name for itself (title, og:site_name,
 * og:title, application-name) has to carry the company name, compared with
 * separators removed so "Alpine Eagle" matches "alpineeagle".
 *
 * A page that names itself nothing in the first few KB is a reject: a missed
 * logo is a coloured initial, a wrong one is another company's mark.
 *
 * NOT sufficient on its own -- see isHoldingPage below, which has to run beside
 * it. This check ASKS whether the name is there and a holding page always says
 * yes, because it titles itself with the domain and the domain carries the name.
 */
export function pageNamesCompany(head, name) {
  const n = normalizeName(name);
  if (!n) return false;
  const parts = selfNames(head);
  if (!parts.length) return false;
  const haystack = fold(parts.join(" ")).replace(/[^a-z0-9]/g, "");
  return haystack.includes(n);
}

/** Wording that only ever appears on a page with no company behind it yet. */
const HOLDING_MARKERS = [
  "under construction",
  "coming soon",
  "site is being built",
  "website is being built",
  "default web page",
  "default page",
  "welcome to nginx",
  "apache2 ubuntu default",
  "index of /",
  "en construccion",
  "proximamente",
  "demnachst",
  "im aufbau",
];

/**
 * Is this page a holding page rather than a company? It has to be asked
 * SEPARATELY from pageNamesCompany, because that gate cannot answer it: a
 * holding page names itself with its own domain, the domain is built from the
 * company handle, so the company name is always in there and the gate always
 * says yes. Measured live on 2026-08-27, four of them passed it:
 *   finto.com          <title>finto.com</title>, a 980-byte Above.com stub
 *   neuralconcept.ai   <title>neuralconcept.ai</title> (the company is .com,
 *                      whose own title is a tagline, so the name gate REJECTED
 *                      the real site and ACCEPTED the placeholder)
 *   nevis.com          <title>Nevis is under construction</title>
 *   sessions.com       <title>Sessions.com</title>
 * Two shapes, both narrow on purpose:
 *   1. every name the page gives itself IS the candidate domain, dot and all.
 *      A real company titles its home page with a brand or a tagline, not with
 *      "example.com"; a parked or reserved domain almost always does. Titling
 *      with the bare brand ("Callosum", "Noah Labs") is NOT this shape.
 *   2. it says in words that there is nothing here yet.
 */
export function isHoldingPage(head, candidate) {
  const parts = selfNames(head);
  const domain = String(candidate || "")
    .toLowerCase()
    .replace(/^www\./, "");
  if (domain && parts.length) {
    const bare = (s) =>
      fold(s)
        .replace(/^www\./, "")
        .replace(/[^a-z0-9.-]/g, "")
        .replace(/\.+$/, "");
    if (parts.every((p) => bare(p) === domain)) return true;
  }
  const text = fold(parts.join(" ")).replace(/\s+/g, " ");
  return HOLDING_MARKERS.some((m) => text.includes(m));
}

// ── The tie-breaker: does this site hire through the SAME ATS tenant? ────────
// Where the ATS puts the tenant, per ATS: `sub` means {handle}.{suffix},
// `path` means {suffix}/{handle}. Same shapes the parser above reads, one map.
const ATS_TENANT_SHAPE = {
  recruitee: { sub: "recruitee.com" },
  personio: { sub: "jobs.personio" },
  teamtailor: { sub: "teamtailor.com" },
  bamboohr: { sub: "bamboohr.com" },
  factorial: { sub: "factorialhr." },
  welcomekit: { sub: "welcomekit.co" },
  freshteam: { sub: "freshteam.com" },
  keka: { sub: "keka.com" },
  viterbit: { sub: "viterbit.site" },
  odoo: { sub: "odoo.com" },
  hibob: { sub: "careers.hibob.com" },
  haileyhr: { sub: "careers.haileyhr.app" },
  greenhouse: { path: "greenhouse.io" },
  lever: { path: "lever.co" },
  ashby: { path: "ashbyhq.com" },
  workable: { path: "workable.com" },
  smartrecruiters: { path: "smartrecruiters.com" },
  join: { path: "join.com/companies" },
  dover: { path: "dover.com/apply" },
  rippling: { path: "rippling.com" },
  gem: { path: "gem.com" },
  screenloop: { path: "screenloop.com/careers" },
  comeet: { path: "comeet.com/jobs" },
  "revolut-people": { path: "revolutpeople.com" },
};

/** Every string that would appear in a link to this company's own ATS board. */
export function atsTenantMarkers(ats, handle) {
  const forms = [...new Set([String(handle || "").toLowerCase(), normalizeHandle(handle)].filter(Boolean))];
  const shape = ATS_TENANT_SHAPE[ats];
  const out = [];
  for (const h of forms) {
    if (ats === "workday") {
      out.push(`${h}.wd`, `${h}.myworkdaysite.com`);
      continue;
    }
    if (!shape) continue;
    if (shape.sub) out.push(`${h}.${shape.sub}`);
    if (shape.path) out.push(`${shape.path}/${h}`);
    if (ats === "greenhouse") out.push(`for=${h}`);
  }
  return out;
}

/**
 * When two candidate domains both answer as the company, this is what tells
 * them apart: the company's own site links the board its job was scraped from.
 * Measured live on 2026-08-27: granola.ai/careers links ashbyhq.com/granola and
 * granola.com (a food site) links nothing, apify.com/careers links
 * ashbyhq.com/apify and apify.ai links nothing, cursor.com/careers links
 * ashbyhq.com/cursor and cursor.io links nothing.
 */
export function bodyLinksAtsTenant(body, ats, handle) {
  const text = String(body || "").toLowerCase();
  if (!text) return false;
  return atsTenantMarkers(ats, handle).some((m) => text.includes(m));
}

// An icon probe used to sit here as a second chance for a candidate whose root
// refused to be read. It was removed on 2026-08-27, in review: a 200 with image
// bytes at /favicon.ico proves the domain resolves and serves a file, and
// NOTHING about who owns it -- the icon carries no company name, so a domain
// admitted this way skipped the name gate and the parking gate and went
// straight to a write. Replayed over 60 companies of the live pool it cost 70
// requests (41% of the run's budget, and it was not counted against
// --max-probes) and produced zero passes, so removing it costs no coverage.

/**
 * A request that never got an answer: was that proof there is no site there, or
 * just a bad moment? Only "this name does not resolve" is proof. Everything
 * else -- a timeout, a reset, a refused connection, a bad certificate -- is a
 * bad moment, and the caller does not REMEMBER it: the probe cache keeps
 * answers, never silences, so the next run asks again instead of writing the
 * domain off for thirty days.
 *
 * Holding a company back entirely when one of its candidates went quiet was
 * tried and dropped: measured over the live pool it cost 92 of 311 companies
 * their logo, and the case that suggested it (Alice & Bob losing to a crypto
 * wallet on alicebob.com) turned out to be an HTML-entity bug in the name
 * check above, not a timeout at all.
 */
export function classifyFetchError(error) {
  const code = error?.cause?.code || error?.code || "";
  return code === "ENOTFOUND" ? "dead" : "unreachable";
}

// ── Probe cache ──────────────────────────────────────────────────────────────

/**
 * Is this error "the probe-cache table is not there yet"? Two shapes, because
 * two layers answer: Postgres says undefined_table (42P01), and PostgREST,
 * which is what supabase-js talks to, answers PGRST205 with "Could not find the
 * table ... in the schema cache" long before the query reaches Postgres. The
 * migration is applied by hand after review, so the script must run cleanly
 * against a database that does not have the table yet.
 */
export function isMissingProbeTableError(error) {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /relation .* does not exist|could not find the table/i.test(error.message || "");
}

// ── Probe cache freshness ────────────────────────────────────────────────────

/** A remembered failure is re-probed after this long, so a domain that gets
 *  registered later is not written off forever. A remembered success never
 *  needs re-probing: the company it belonged to already has its logo domain. */
export const NEGATIVE_PROBE_TTL_DAYS = 30;

export function isProbeCacheFresh(row, now = Date.now(), ttlDays = NEGATIVE_PROBE_TTL_DAYS) {
  if (!row) return false;
  if (row.ok) return true;
  const probedAt = Date.parse(row.probed_at ?? "");
  if (Number.isNaN(probedAt)) return false;
  return now - probedAt < ttlDays * 24 * 60 * 60 * 1000;
}

// ── Run counters ─────────────────────────────────────────────────────────────

export function newHandleTally() {
  return {
    companies: 0,
    noHandle: 0,
    nameMismatch: 0,
    noCandidate: 0,
    candidatesTried: 0,
    cacheHits: 0,
    validated: 0,
    rejected: 0,
    otherBrand: 0,
    holdingPage: 0,
    unreachable: 0,
    ambiguous: 0,
    tieBreakFetches: 0,
    tieBroken: 0,
    budgetExhausted: 0,
    written: 0,
  };
}

export function handleSummaryLine(t, { apply }) {
  return (
    `logo-backfill(handle): ${t.companies} company(ies) with an ATS handle to try` +
    ` · candidates ${t.candidatesTried} · cache hits ${t.cacheHits}` +
    ` · validated ${t.validated} · rejected ${t.rejected} (other brand ${t.otherBrand}, holding page ${t.holdingPage})` +
    ` · unreachable ${t.unreachable} · tie-broken ${t.tieBroken} (${t.tieBreakFetches} careers reads) · ambiguous ${t.ambiguous} · no handle ${t.noHandle} · name mismatch ${t.nameMismatch} · no candidate ${t.noCandidate}` +
    (t.budgetExhausted ? ` · budget exhausted on ${t.budgetExhausted}` : "") +
    (apply ? ` · wrote ${t.written}` : " · [dry run] no writes")
  );
}
