/**
 * Reading the company website the ATS board already PUBLISHES (issue #153, the
 * logo-coverage defect, round 5). The pure half: no network, no DB.
 * scripts/logo-backfill.mjs owns the requests and the writes.
 *
 * WHY THIS EXISTS. The handle pass (scripts/logo-handle-lib.mjs) BUILDS a domain
 * out of the ATS tenant slug and then validates it. Measured on 2026-08-27 by
 * replaying 60 random companies of the live pool, that produced 39 writes and 4
 * of them were another company's mark -- about 1 in 10. The rate cannot be
 * validated down, because the failure is structural: a parked or reserved domain
 * is BUILT from the same handle, so it always carries the company name and always
 * passes a name gate. The four live ones:
 *   finto.com          an Above.com parking stub; the company is gofinto.com
 *   nevis.com          "Nevis is under construction"; the company is neviswealth.com
 *   neuralconcept.ai   a placeholder ACCEPTED while the real neuralconcept.com
 *                      was rejected (its title is a tagline, not the name)
 *   lime.ai            a battery-analytics company; the scooter company is li.me
 *
 * The board that the apply URL names already knows the answer. Over the 243
 * Ashby + Workable companies in the pool, 232 (95%) publish a usable website,
 * and 82 of those carry a truth no handle can generate: adaptyvbio.com,
 * checklyhq.com, li.me, anna.money, carwow.co.uk, build.inc.
 *
 * So the board is read FIRST and the handle guess is the last resort. Every
 * endpoint and field below was read off a live response on 2026-08-27, and the
 * host shapes come from the same scrapers scripts/logo-handle-lib.mjs reads
 * (scripts/scrape.mjs, scripts/sources/ats-extra.mjs, scripts/sources/joincom.mjs,
 * scripts/jd-backfill-lib.mjs atsKindOf) -- nothing here is invented.
 *
 * Unit tests: src/test/logo-board-lib.test.ts (vitest, offline, real fixtures).
 */
import { domainFromUrl } from "./logo-lib.mjs";
import { normalizeName, normalizeHandle } from "./logo-handle-lib.mjs";

// ── Provenance vocabulary (migration 20260827190000) ─────────────────────────
// companies.logo_domain used to carry no record of HOW it was obtained, so a
// wrong row could never be told from a good one and dropped out of every future
// backfill (the scan is .is("logo_domain", null)). These four values are that
// record, and "guess" is the one the board pass is allowed to REVISIT.
export const LOGO_SOURCE_BOARD = "board"; // the ATS board published this website
export const LOGO_SOURCE_COMPANY_URL = "company_url"; // derived from the company's own careers_url/website on file
export const LOGO_SOURCE_GUESS = "guess"; // built from the ATS handle and probed (scripts/logo-handle-lib.mjs)
export const LOGO_SOURCE_MANUAL = "manual"; // set by hand; never overwritten
export const LOGO_SOURCES = [LOGO_SOURCE_BOARD, LOGO_SOURCE_COMPANY_URL, LOGO_SOURCE_GUESS, LOGO_SOURCE_MANUAL];

/** Only a guessed domain may be replaced. A board-read, a company-URL-derived
 *  and a hand-set domain are all facts about the company; a guess is not. */
export function isRevisitableSource(source) {
  return source === LOGO_SOURCE_GUESS;
}

// ── ATS → the request that carries the published website ─────────────────────
// kind "json" -> the caller parses the body as JSON; "html" -> hands it over raw.
const BOARD_REQUESTS = {
  // Ashby serves the board shell with window.__appData, whose organization block
  // carries publicWebsite and customJobsPageUrl. (api.ashbyhq.com/posting-api/
  // job-board/{handle}, the endpoint scrape.mjs uses for the jobs, carries
  // neither -- checked live on 2026-08-27, its only keys are jobs + apiVersion.)
  ashby: (h) => ({ url: `https://jobs.ashbyhq.com/${encodeURIComponent(h)}`, kind: "html" }),
  // Workable publishes the account itself, website in `url`.
  workable: (h) => ({ url: `https://apply.workable.com/api/v1/accounts/${encodeURIComponent(h)}`, kind: "json" }),
  // Lever renders the company's home-page link into the board footer.
  lever: (h) => ({ url: `https://jobs.lever.co/${encodeURIComponent(h)}`, kind: "html" }),
  // Greenhouse renders the board logo as a link to the company's own site.
  greenhouse: (h) => ({ url: `https://job-boards.greenhouse.io/${encodeURIComponent(h)}`, kind: "html" }),
  // join.com publishes a schema.org Organization whose sameAs is the website.
  join: (h) => ({ url: `https://join.com/companies/${encodeURIComponent(h)}`, kind: "html" }),
};

/** The one request that asks a board for a company's website, or null when this
 *  ATS publishes none. `handle` is the RAW tenant slug from the apply URL. */
export function boardWebsiteRequest(ats, handle) {
  const build = BOARD_REQUESTS[ats];
  const h = String(handle ?? "").trim();
  if (!build || !h) return null;
  return { ats, handle: h, ...build(h) };
}

export function boardPublishesWebsite(ats) {
  return Boolean(BOARD_REQUESTS[ats]);
}

// ── Response → { name, website } ─────────────────────────────────────────────

/** The JSON object that starts at the first `{` after `marker`, read by
 *  counting braces: these blobs are far too big and too nested for a regex,
 *  and a non-greedy one stops at the first inner `}` (it did, on Granola). */
function jsonAfter(html, marker) {
  const at = String(html || "").indexOf(marker);
  if (at < 0) return null;
  const text = String(html);
  const start = text.indexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Every schema.org node in a page's ld+json blocks, flattened. */
function jsonLdNodes(html) {
  const out = [];
  for (const block of String(html || "").matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let parsed;
    try {
      parsed = JSON.parse(block[1].trim());
    } catch {
      continue;
    }
    const push = (x) => {
      if (x && typeof x === "object") out.push(x);
    };
    if (Array.isArray(parsed)) parsed.forEach(push);
    else {
      push(parsed);
      if (Array.isArray(parsed["@graph"])) parsed["@graph"].forEach(push);
    }
  }
  return out;
}

function firstString(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v)) {
      const hit = v.find((x) => typeof x === "string" && x.trim());
      if (hit) return hit.trim();
    }
  }
  return null;
}

const EXTRACTORS = {
  /** window.__appData.organization: { name, publicWebsite, customJobsPageUrl }.
   *  publicWebsite is the company's site; customJobsPageUrl is its own careers
   *  page, on the same domain, and is what Granola publishes instead. */
  ashby(html) {
    const app = jsonAfter(html, "window.__appData");
    const org = app && app.organization;
    if (!org) return null;
    return { name: firstString(org.name), website: firstString(org.publicWebsite, org.customJobsPageUrl) };
  },

  /** GET apply.workable.com/api/v1/accounts/{handle} -> { name, url, ... }. */
  workable(json) {
    if (!json || typeof json !== "object") return null;
    return { name: firstString(json.name), website: firstString(json.url) };
  },

  /** The board footer: <div class="main-footer-text"><p><a href="…">X Home
   *  Page</a></p>. Lever's own links (job-seeker-support, lever.co) are dropped
   *  by domainFromUrl later, but the block is scoped first so a stray link
   *  elsewhere on the page can never be read as the company's site. */
  lever(html) {
    const block = String(html || "").match(/main-footer-text[\s\S]{0,600}/i);
    if (!block) return null;
    for (const m of block[0].matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      if (/(^|\/\/|\.)lever\.co\b/i.test(m[1])) continue;
      const label = m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      return { name: firstString(label.replace(/\s*home\s*page\s*$/i, "")), website: m[1] };
    }
    return null;
  },

  /** The board logo is an anchor to the company's own site, and the same href
   *  sits in the embedded boardConfiguration.logo.href. The anchor is read,
   *  because it is the rendered fact rather than a blob key. */
  greenhouse(html) {
    const text = String(html || "");
    const m =
      text.match(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*class=["'][^"']*\blogo\b[^"']*["']/i) ||
      text.match(/"logo":\s*\{[^}]*?"href":\s*"(https?:\/\/[^"]+)"/i);
    if (!m) return null;
    const title = (text.match(/<title[^>]*>([^<]*)/i) || [])[1] || "";
    return { name: firstString(title.replace(/^\s*jobs at\s+/i, "").trim()), website: m[1] };
  },

  /** schema.org Organization: name + sameAs. `url` is the join.com page itself,
   *  never the company's site, so only sameAs is read. */
  join(html) {
    const org = jsonLdNodes(html).find((n) => n["@type"] === "Organization" || (Array.isArray(n["@type"]) && n["@type"].includes("Organization")));
    if (!org) return null;
    const website = firstString(org.sameAs);
    if (!website) return null;
    return { name: firstString(org.name), website };
  },
};

/**
 * What this board says about this company: { name, website }, or null when the
 * board answered but published neither. `payload` is the parsed JSON for a
 * "json" request and the raw body for an "html" one.
 */
export function boardCompanyFromResponse(ats, payload) {
  const extract = EXTRACTORS[ats];
  if (!extract) return null;
  let hit;
  try {
    hit = extract(payload);
  } catch {
    return null;
  }
  if (!hit || !hit.website) return null;
  return { name: hit.name || null, website: hit.website };
}

// ── Gates ────────────────────────────────────────────────────────────────────

/**
 * Is this board tenant really this company's? It has to be asked, because some
 * rows in the pool carry an apply URL that points at somebody ELSE's tenant
 * ("Semana | personio | deskbird", "Atlas Metrics | rippling | novata" — both
 * live today), and reading that tenant's published website would put the wrong
 * mark on the map just as surely as a guessed domain does.
 *
 * Two independent proofs, either is enough:
 *   1. the board's own name for the tenant matches the company name — this is
 *      the one that admits the truths a handle cannot reach ("Nevis Wealth" for
 *      Nevis), and
 *   2. the handle names the company (handleMatchesName's rule, reused) — this
 *      is the one that admits a board that publishes no name at all (Lever).
 * Names are compared with separators removed and one allowed to be a prefix of
 * the other, so "Neural Concept" matches "Neuralconcept" and "Nevis Wealth"
 * matches "Nevis", while "deskbird" matches "Semana" no way at all.
 */
export function boardOwnershipOk({ boardName, handle, companyName } = {}) {
  const company = normalizeName(companyName);
  if (!company) return false;
  const board = normalizeName(boardName);
  // Four characters before a prefix counts, the same floor handleMatchesName
  // uses: shorter than that and "Ito" would own "Itom", "Itonics" and "Itoro".
  if (board === company && board) return true;
  if (board && board.length >= 4 && company.startsWith(board)) return true;
  if (board && company.length >= 4 && board.startsWith(company)) return true;
  const h = normalizeHandle(handle);
  if (!h) return false;
  const flat = h.replace(/-/g, "");
  if (flat === company) return true;
  if (flat.length >= 4 && company.startsWith(flat)) return true;
  return company.length >= 4 && flat.startsWith(company);
}

/**
 * The logo domain a published website yields, or null. domainFromUrl is the one
 * place that knows every hosted-ATS/platform host, so a board that publishes a
 * link back to itself (or to LinkedIn, or to Notion) resolves to nothing here
 * rather than becoming somebody's logo.
 */
export function logoDomainFromWebsite(website) {
  return domainFromUrl(website);
}

/**
 * The whole preference order in one place: what the board published wins, and
 * the validated handle guess is only ever the last resort. Returns
 * { domain, source } or null. Pinned by src/test/logo-board-lib.test.ts —
 * the ordering is the entire point of this change, so it is tested, not implied.
 */
export function preferLogoDomain({ boardDomain, guessDomain } = {}) {
  if (boardDomain) return { domain: boardDomain, source: LOGO_SOURCE_BOARD };
  if (guessDomain) return { domain: guessDomain, source: LOGO_SOURCE_GUESS };
  return null;
}

// ── Degrading gracefully when the column is not there yet ────────────────────

/**
 * Is this error "companies.logo_domain_source does not exist"? The migration is
 * applied by hand after review, so every run before that has to work without it:
 * PostgREST answers PGRST204 ("Could not find the 'x' column ... in the schema
 * cache") on a write and 42703 (undefined_column) comes from Postgres itself.
 */
export function isMissingLogoSourceColumnError(error) {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .*logo_domain_source.* does not exist|could not find the '?logo_domain_source'? column/i.test(
    error.message || "",
  );
}

// ── Run counters ─────────────────────────────────────────────────────────────

export function newBoardTally() {
  return {
    asked: 0,
    published: 0,
    resolved: 0,
    noWebsite: 0,
    notOwned: 0,
    unusableHost: 0,
    unreachable: 0,
    unsupportedAts: 0,
    revisited: 0,
    budgetExhausted: 0,
    written: 0,
  };
}

export function boardSummaryLine(t, { apply } = {}) {
  return (
    `logo-backfill(board): asked ${t.asked} board(s) · published a website ${t.published}` +
    ` · usable domain ${t.resolved} · no website ${t.noWebsite} · tenant not owned ${t.notOwned}` +
    ` · unusable host ${t.unusableHost} · unreachable ${t.unreachable} · ATS publishes none ${t.unsupportedAts}` +
    ` · revisiting a guess ${t.revisited}` +
    (t.budgetExhausted ? ` · budget exhausted on ${t.budgetExhausted}` : "") +
    (apply ? ` · wrote ${t.written}` : " · [dry run] no writes")
  );
}
