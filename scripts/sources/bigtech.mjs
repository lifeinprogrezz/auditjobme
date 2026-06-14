/**
 * Big-tech sources for the daily scrape -> shared `jobs` pool.
 *
 * Five proprietary careers APIs, one "product manager" query each:
 *   Google · Meta · Amazon · Microsoft · Apple.
 * (Shopify is intentionally dropped — its mission-themed careers model has no
 * scrapable list of openings.)
 *
 * All cold HTTP — NO browser / session / auth. Most big-tech PM roles are US and
 * get dropped by isEU() (expected); only the EU ones survive. Shapes were
 * discovered via the career-ops scan.mjs (Playwright network panel).
 *
 * Job object contract (see scripts/scrape.mjs):
 *   { company, title, url, location, remote, source, posted_at, jd_text, seniority }
 *
 * Export: `sources = [{ company, run }]`; run() returns the filtered EU-PM array.
 * The orchestrator (scrape.mjs) spreads these into SOURCES.
 */
import { isPM, isEU, inferSeniority, stripHtml } from "../job-filters.mjs";

const TIMEOUT_MS = 20000;
const fetchOpts = (extra = {}) => ({ signal: AbortSignal.timeout(TIMEOUT_MS), ...extra }); // fresh signal per call
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_PAGES = 15; // per-source pagination ceiling (bounds cost on big result sets)

// Normalize a date-ish value to a YYYY-MM-DD string, or null. posted_at in the
// jobs contract is a nullable ISO-ish date; big-tech feeds give unix seconds,
// human-formatted strings ("March 10, 2026"), or ISO — all handled here.
function toPostedAt(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000; // tolerate epoch s or ms
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const isRemote = (location, title) =>
  /remote/i.test(location || "") || /remote/i.test(title || "");

// Shared shaping: filter PM titles, build the contract object, then keep EU only.
// `rows` are pre-normalized {title, url, location, posted, jd} objects.
function shape(rows, source) {
  return rows
    .filter((r) => isPM(r.title))
    .map((r) => ({
      company: r.company,
      title: r.title,
      url: r.url,
      location: r.location || null,
      remote: isRemote(r.location, r.title),
      source,
      posted_at: toPostedAt(r.posted),
      jd_text: (r.jd || "").slice(0, 8000) || null,
      seniority: inferSeniority(r.title),
    }))
    .filter((j) => j.url && isEU(j.location));
}

// ── Amazon — clean JSON, paginated by offset ──────────────────────────────────
// GET amazon.jobs/en/search.json?base_query=…&result_limit=100&offset=N
// Each job: { title, job_path, normalized_location, posted_date, basic_qualifications }.
async function fetchAmazon(company) {
  const SIZE = 100;
  const rows = [];
  let offset = 0;
  let total = Infinity;
  for (let page = 0; offset < total && page < MAX_PAGES; page++) {
    const url =
      `https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent("product manager")}` +
      `&result_limit=${SIZE}&offset=${offset}&sort=relevant&loc_query=&query_options=&radius=24km`;
    const res = await fetch(url, fetchOpts({ headers: { Accept: "application/json" } }));
    if (!res.ok) throw new Error(`Amazon HTTP ${res.status}`);
    const json = await res.json();
    total = json.hits || 0;
    const jobs = json.jobs || [];
    if (jobs.length === 0) break;
    rows.push(
      ...jobs.map((j) => ({
        company,
        title: j.title || "",
        url: j.job_path ? `https://www.amazon.jobs${j.job_path}` : "",
        location: j.normalized_location || j.location || "",
        posted: j.posted_date || j.updated_time || "",
        jd: stripHtml(j.basic_qualifications || j.description || ""),
      })),
    );
    offset += SIZE;
  }
  return shape(rows, "amazon");
}

// ── Microsoft — Phenom JSON, paginated by start (step 10) ─────────────────────
// GET apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=…&location=&start=N&
// { data: { positions: [{ name, locations[], postedTs, positionUrl, displayJobId }], count } }.
async function fetchMicrosoft(company) {
  const PAGE_SIZE = 10;
  const rows = [];
  let start = 0;
  let total = Infinity;
  for (let page = 0; start < total && page < MAX_PAGES; page++) {
    const url =
      `https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com` +
      `&query=${encodeURIComponent("product manager")}&location=&start=${start}&`;
    const res = await fetch(url, fetchOpts({ headers: { Accept: "application/json" } }));
    if (!res.ok) throw new Error(`Microsoft HTTP ${res.status}`);
    const json = await res.json();
    total = json?.data?.count || 0;
    const positions = json?.data?.positions || [];
    if (positions.length === 0) break;
    rows.push(
      ...positions.map((j) => ({
        company,
        title: j.name || "",
        url: j.positionUrl ? `https://apply.careers.microsoft.com${j.positionUrl}` : "",
        location: (j.standardizedLocations || j.locations || []).join("; "),
        posted: j.postedTs || "",
        jd: "", // list endpoint omits the JD body
      })),
    );
    start += PAGE_SIZE;
  }
  return shape(rows, "microsoft");
}

// ── Meta — GraphQL POST, form-encoded, returns all jobs in one shot ──────────
// POST metacareers.com/graphql with doc_id + variables={search_input:{q:"product manager"}}.
// data.job_search_with_featured_jobs.all_jobs[] = { id, title, locations[] }.
async function fetchMeta(company) {
  const body = new URLSearchParams({
    doc_id: "29615178951461218",
    fb_api_req_friendly_name: "CareersJobSearchResultsDataQuery",
    fb_api_caller_class: "RelayModern",
    variables: JSON.stringify({ search_input: { q: "product manager" } }),
  });
  const res = await fetch(
    "https://www.metacareers.com/graphql",
    fetchOpts({
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      body: body.toString(),
    }),
  );
  if (!res.ok) throw new Error(`Meta HTTP ${res.status}`);
  const json = await res.json();
  const list = json?.data?.job_search_with_featured_jobs?.all_jobs || [];
  const rows = list.map((j) => ({
    company,
    title: j.title || "",
    url: j.id ? `https://www.metacareers.com/jobs/${j.id}/` : "",
    location: (j.locations || []).join("; "),
    posted: "", // Meta list endpoint omits the posted date
    jd: "",
  }));
  return shape(rows, "meta");
}

// ── Apple — React-Router SSR hydration, paginated by page (step 20) ──────────
// GET jobs.apple.com/en-us/search?search=…&sort=relevance&page=N (sort=relevance REQUIRED).
// Results in `window.__staticRouterHydrationData = JSON.parse("…");` →
// JSON.parse(JSON.parse(captured)).loaderData.search.searchResults[].
async function fetchApple(company) {
  const PAGE_SIZE = 20;
  const rows = [];
  let total = Infinity;
  const HYDRATION_RE =
    /window\.__staticRouterHydrationData\s*=\s*JSON\.parse\((".*?")\);<\/script>/s;
  for (let page = 1; (page - 1) * PAGE_SIZE < total && page <= MAX_PAGES; page++) {
    const url = `https://jobs.apple.com/en-us/search?search=${encodeURIComponent(
      "product manager",
    )}&sort=relevance&page=${page}`;
    const res = await fetch(
      url,
      fetchOpts({ headers: { "User-Agent": BROWSER_UA, Accept: "text/html" } }),
    );
    if (!res.ok) throw new Error(`Apple HTTP ${res.status}`);
    const m = (await res.text()).match(HYDRATION_RE);
    if (!m) break;
    let data;
    try {
      data = JSON.parse(JSON.parse(m[1])); // outer = quoted JS string literal, inner = JSON
    } catch {
      break;
    }
    const search = data?.loaderData?.search || {};
    const results = search.searchResults || [];
    total = search.totalRecords || results.length;
    if (results.length === 0) break;
    rows.push(
      ...results.map((j) => {
        const slug = j.transformedPostingTitle || "";
        const teamCode = (j.team && j.team.teamCode) || "";
        const location = (j.locations || [])
          .map((l) => l.name || l.countryName || "")
          .filter(Boolean)
          .join("; ");
        return {
          company,
          title: j.postingTitle || "",
          url: j.id
            ? `https://jobs.apple.com/en-us/details/${j.id}/${slug}${
                teamCode ? `?team=${teamCode}` : ""
              }`
            : "",
          location,
          posted: j.postDateInGMT || "",
          jd: j.jobSummary || "",
        };
      }),
    );
    if (results.length < PAGE_SIZE) break;
  }
  return shape(rows, "apple");
}

// ── Google — SSR HTML, AF_initDataCallback ds:1 block, eval array, page by N ──
// GET google.com/about/careers/applications/jobs/results/?q=…&page=N. Jobs live in
// AF_initDataCallback({key:'ds:1', ...data:[<jobsArray>,null,<total>,<perPage>], ...}).
// Each job is a 21-elem positional array: [0]=id, [1]=title, [9]=locations,
// [12]=[posted_unix,nanos], [3][1]+[4][1]=JD html. Build the PUBLIC results URL
// from id + title slug (NOT the signin url at [2]).
// Best-effort: the eval-parse of an SSR array literal is the brittle path here —
// a markup change to the AF_initDataCallback shape breaks the regex; on any parse
// failure we bail that page rather than throw, so a layout drift yields fewer
// rows, never a crash.
async function fetchGoogle(company) {
  const PAGE_SIZE = 20;
  const rows = [];
  let total = Infinity;
  for (let page = 1; (page - 1) * PAGE_SIZE < total && page <= MAX_PAGES; page++) {
    const url = `https://www.google.com/about/careers/applications/jobs/results/?q=${encodeURIComponent(
      "product manager",
    )}&page=${page}`;
    const res = await fetch(
      url,
      fetchOpts({ headers: { "User-Agent": BROWSER_UA, Accept: "text/html" } }),
    );
    if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
    const html = await res.text();
    // AF_initDataCallback({key: 'ds:1', ...data: <jobs>, sideChannel: {}});
    const m = html.match(
      /AF_initDataCallback\(\{key:\s*'ds:1'[^}]*?data:(\[[\s\S]*?\]),\s*sideChannel:/,
    );
    if (!m) break;
    let data;
    try {
      // Array literal (not strict JSON): unicode-escapes + nested arrays/nulls.
      data = new Function(`return ${m[1]};`)();
    } catch {
      break;
    }
    const jobArray = data?.[0] || [];
    total = data?.[2] || jobArray.length;
    if (jobArray.length === 0) break;
    rows.push(
      ...jobArray.map((j) => {
        const id = j[0] || "";
        const slug = String(j[1] || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        const locArr = j[9] || [];
        const location = locArr
          .map((l) => (Array.isArray(l) ? l[0] : ""))
          .filter(Boolean)
          .join("; ");
        const postedSec = Array.isArray(j[12]) ? j[12][0] : null;
        const resp = (j[3] && j[3][1]) || "";
        const qual = (j[4] && j[4][1]) || "";
        return {
          company,
          title: j[1] || "",
          // PUBLIC results detail URL (id + slug) — j[2] is the auth-walled signin url.
          url: id
            ? `https://www.google.com/about/careers/applications/jobs/results/${id}-${slug}`
            : j[2] || "",
          location,
          posted: postedSec,
          jd: stripHtml([resp, qual].filter(Boolean).join("\n\n")),
        };
      }),
    );
    if (jobArray.length < PAGE_SIZE) break;
  }
  return shape(rows, "google");
}

export const sources = [
  { company: "Google", run: () => fetchGoogle("Google") },
  { company: "Meta", run: () => fetchMeta("Meta") },
  { company: "Amazon", run: () => fetchAmazon("Amazon") },
  { company: "Microsoft", run: () => fetchMicrosoft("Microsoft") },
  { company: "Apple", run: () => fetchApple("Apple") },
];
