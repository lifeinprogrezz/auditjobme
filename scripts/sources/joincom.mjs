/**
 * Join.com — the public `candidate-api` GraphQL board listing.
 *
 * Join has no bulk feed: the sitemap it advertises answers 403 behind
 * Cloudflare, and the public GraphQL Query type exposes only `publicJob` and
 * `publicJobs`, whose input requires `companyId: Int!` — there is no
 * cross-company search. So a board is read in two steps, both credential-free
 * (probed live 2026-08-19):
 *
 *   1. slug -> companyId, ONCE per board, cached in boards.json as `id`:
 *      GET https://join.com/api/companies/by-domain/{token}
 *      200 `{"id":15211,"name":"Superchat","domain":"superchat",…}` — a dead
 *      slug answers 404 `{"error":{"msg":"Entity not found"}}`, and that 404 is
 *      the board-LIVENESS guard: the GraphQL endpoint answers an unknown
 *      companyId with a perfectly normal 200 rowCount 0, so it cannot tell a
 *      dead board from an empty one. This host IS rate limited (429 above
 *      roughly 10 req/s, no Retry-After), hence the paced queue below.
 *   2. board listing, ONE request per company, no pagination to follow:
 *      POST https://join.com/candidate-api/graphql with PublicJobsList at
 *      pageSize 200. Every probed board fit on page 1, and the endpoint is NOT
 *      rate limited (80 serial posts in 8.6 s, all 200). Only `status:"ONLINE"`
 *      rows are ever returned.
 *
 * With `id` cached, a nightly run therefore costs exactly ONE unlimited GraphQL
 * call per board and zero calls to the rate-limited REST host.
 *
 * Shape, same as the Greenhouse/Lever/Ashby/Teamtailor/Personio siblings:
 *   { company, title, url, location, remote, source, posted_at, jd_text, seniority }
 * filtered through the shared job-filters (isInScope(title) && isEU(location))
 * — the five role_family verticals since #34, not PM-only. The row also carries
 * role_family (#34 contract) from the SAME classifier scrape.mjs stamps rows
 * with centrally, so the two can never disagree, plus `workplace` from Join's
 * authoritative 3-way `workplaceType` (ONSITE|HYBRID|REMOTE) — the same
 * structured-field contract the Lever adapter in scrape.mjs already uses, and
 * normalized centrally by workplace-lib.
 *
 * Posting url: `https://join.com/companies/{company.domain}/{idParam}` — derived,
 * no extra request, all 9 probed urls answered 200. `idParam` is NEVER rebuilt
 * from `id`: its numeric prefix is a DIFFERENT number on most rows (id 14996434
 * -> idParam "16571949-business-development-trainee-programm-m-w-d").
 *
 * jd_text: `descriptionHtml` is served on the list only when the employer wrote
 * the ad in Join's rich editor — 2 of 144 live rows on 2026-08-19. It is used
 * when present and left null otherwise; scripts/jd-backfill.mjs already routes
 * join.com hosts to its JSON-LD reader (makeJsonLd("join")) and job pages carry
 * a complete JobPosting block, so the body arrives there rather than costing a
 * rate-limited REST call per role here.
 *
 * Location: `city.countryName` is already ENGLISH on this endpoint ("Germany",
 * "Belgium", "Switzerland", "Spain"), so the shared EU filter reads it directly
 * — no ISO-code map (Teamtailor) and no city->country map (Personio) is needed.
 * The REST detail endpoint localizes the same field ("Deutschland"), which is
 * one more reason this connector reads the GraphQL document.
 *
 * Boards live in scripts/boards.json under "join" as
 *   { "company": "Omnisent", "token": "omnisent", "id": 157757 }
 * `token` is the /companies/{slug} path segment; `id` is the cached companyId
 * and is resolved at sync time. A bad board throws and scrape.mjs logs it per
 * board, so one dead career site never halts the run. The display name is
 * load-bearing: slug collisions are real (skello -> "La Sfoglia Dorata",
 * lago -> "Gaststätte Lago"), so boards.json wins over the item's company name.
 */
import { isInScope, isEU, inferSeniority, stripHtml, classifyRoleFamily } from "../job-filters.mjs";
import { pfetch } from "./_proxy.mjs";

export const JOIN_GRAPHQL_URL = "https://join.com/candidate-api/graphql";
const JOIN_COMPANY_API = "https://join.com/api/companies/by-domain";

/**
 * The board listing query, lifted verbatim from Join's own page bundle
 * (cdn.join.com/job-ad-app/_next/static/chunks/pages/companies/[companySlug]-*.js),
 * not guessed — GraphQL introspection is disabled on this server.
 */
export const PUBLIC_JOBS_QUERY =
  "query PublicJobsList($input: PublicJobsQueryInput!){ publicJobs(input:$input){ items{ id idParam title createdAt updatedAt status workplaceType remoteType descriptionHtml company{id name domain} city{cityName countryName} country{iso3166 name} remoteRegion{defaultCountry{name}} category{name} employmentType{name} hybrid{type weeklyInOfficeDays} } pageInfo{page pageCount pageSize rowCount} } }";

const fetchOpts = (extra = {}) => ({
  signal: AbortSignal.timeout(20000), // fresh signal per call
  ...extra,
});

const toIso = (v) => {
  if (!v) return null;
  const d = new Date(v); // already ISO-8601 UTC ("2026-08-07T12:51:28.983Z")
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * The by-domain host answers 429 above roughly 10 requests a second and sends no
 * Retry-After, and scrape.mjs runs eight boards concurrently — so slug
 * resolution goes through one serial queue with a >=250 ms gap (40 paced calls
 * ran clean where 60 unpaced ones took 27 rejections). Only this host is paced;
 * the GraphQL endpoint has no limit and is called directly.
 */
const REST_MIN_GAP_MS = 250;
let restChain = Promise.resolve();
let restLastAt = 0;

function paced(fn) {
  const run = restChain.then(async () => {
    const wait = REST_MIN_GAP_MS - (Date.now() - restLastAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      restLastAt = Date.now();
    }
  });
  restChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

export const joinCompanyUrl = (b) => `${JOIN_COMPANY_API}/${(b || {}).token}`;

/** The POST body for one board listing. pageSize 200 takes every probed board in one page. */
export const joinJobsPayload = (companyId) => ({
  query: PUBLIC_JOBS_QUERY,
  variables: { input: { companyId, paginationPage: { page: 1, pageSize: 200 } } },
});

/**
 * The public posting url. Built from the item's OWN company domain (the display
 * name is often something else — "spotixx GmbH" lives at /companies/spotixxcom/)
 * and the returned idParam, never a reconstructed one. Empty string when either
 * half is missing, which the row filter then drops.
 */
export function joinJobUrl(item) {
  const it = item || {};
  const domain = String((it.company || {}).domain || "").trim();
  const idParam = String(it.idParam || "").trim();
  return domain && idParam ? `https://join.com/companies/${domain}/${idParam}` : "";
}

/**
 * One location string for an item: its city ("Barcelona, Spain" — countryName is
 * already English here), else the remote region's default country, else the
 * item's own country. Null when the item names no place at all; the shared
 * isEU() keeps unknown places, so a null reads as honestly unknown rather than
 * as a silent non-European drop.
 */
export function pickLocation(item) {
  const it = item || {};
  const city = it.city || null;
  if (city) {
    const s = [String(city.cityName || "").trim(), String(city.countryName || "").trim()]
      .filter(Boolean)
      .join(", ");
    if (s) return s;
  }
  const region = String((((it.remoteRegion || {}).defaultCountry) || {}).name || "").trim();
  if (region) return region;
  const country = String((it.country || {}).name || "").trim();
  return country || null;
}

/** One list item -> one `jobs` row. No filtering here; parseJoinJobs does that. */
export function normalizeJoinItem(item, company) {
  const it = item || {};
  const title = String(it.title || "").trim();
  const location = pickLocation(it);
  const jd = stripHtml(it.descriptionHtml || "").slice(0, 8000);
  return {
    // Slug collisions are real, so the boards.json display name wins over the
    // item's own company name.
    company: company || (it.company || {}).name || null,
    title,
    url: joinJobUrl(it),
    location,
    // The enum is authoritative; the title/location scan only catches the ads
    // that say "Remote" in words on an ONSITE row.
    remote:
      it.workplaceType === "REMOTE" || /remote/i.test(location || "") || /remote/i.test(title),
    // Exact 3-way ("ONSITE"|"HYBRID"|"REMOTE"), normalized centrally — same
    // contract as the Lever adapter's workplace: p.workplaceType.
    workplace: it.workplaceType || null,
    source: "join",
    posted_at: toIso(it.createdAt),
    jd_text: jd || null,
    seniority: inferSeniority(title),
    // Title inference, one rule across sources. Join's own `category` taxonomy
    // ("Telesales", "Data Scientist") is a free employer choice and is ignored.
    role_family: classifyRoleFamily(title),
  };
}

const jobsNode = (doc) => ((doc || {}).data || {}).publicJobs || null;

/** True for a document that really is a PublicJobsList response. */
export function isJoinJobsDoc(doc) {
  if (!doc || typeof doc !== "object") return false;
  const node = jobsNode(doc);
  // An empty board is a legitimate 200 with items: [] (catawiki), so a non-empty
  // check would wrongly reject live tenants.
  return Boolean(node) && Array.isArray(node.items);
}

/** Live openings on the board — the sync-boards liveness/size probe. */
export function countJoinJobs(doc) {
  const node = jobsNode(doc);
  if (!node) return 0;
  const rowCount = (node.pageInfo || {}).rowCount;
  return typeof rowCount === "number" ? rowCount : (node.items || []).length;
}

/** Pure parse: listing document -> the European in-scope rows it contains. */
export function parseJoinJobs(doc, company) {
  const node = jobsNode(doc);
  const items = Array.isArray((node || {}).items) ? node.items : [];
  return items
    // Belt and braces: all 144 probed rows were ONLINE — the public API serves no
    // other status — so this can only ever drop something that should not ship.
    .filter((it) => it && (it.status || "ONLINE") === "ONLINE")
    .map((it) => normalizeJoinItem(it, company))
    .filter((j) => j.company && j.url && isInScope(j.title) && isEU(j.location));
}

/**
 * Resolve a board slug to its company record. The 404 here is the board-liveness
 * signal (see the header); paced because this host rate-limits.
 */
export async function fetchJoinCompany(b) {
  const res = await paced(() =>
    pfetch(joinCompanyUrl(b), fetchOpts({ headers: { Accept: "application/json" } })),
  );
  if (res.status === 404) throw new Error("board not found (by-domain 404)");
  if (!res.ok) throw new Error(`HTTP ${res.status}`); // 429 = paced queue outrun
  const doc = await res.json();
  if (!doc || typeof doc.id !== "number") throw new Error("not a Join company record");
  return doc;
}

/** The raw listing document for one companyId. One request, whole board. */
export async function fetchJoinBoard(companyId) {
  const res = await pfetch(
    JOIN_GRAPHQL_URL,
    fetchOpts({
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(joinJobsPayload(companyId)),
    }),
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = await res.json();
  if (!isJoinJobsDoc(doc)) throw new Error("not a Join publicJobs document");
  return doc;
}

export async function fetchJoin(b) {
  // A cached id keeps the run off the rate-limited REST host entirely.
  // boards.json seeds `companyId`; `id` stays accepted for callers that already
  // resolved one. Either way a seeded id skips the slug->id lookup entirely.
  const seeded = typeof b.companyId === "number" ? b.companyId : b.id;
  const companyId = typeof seeded === "number" ? seeded : (await fetchJoinCompany(b)).id;
  return parseJoinJobs(await fetchJoinBoard(companyId), b.company);
}
