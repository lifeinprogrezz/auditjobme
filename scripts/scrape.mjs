#!/usr/bin/env node
/**
 * Daily job scrape -> shared `jobs` pool. v1 sources: Greenhouse + Lever + Ashby public APIs
 * (no auth to read). Run by .github/workflows/scrape.yml (daily cron). Needs SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY (GitHub repo secrets) to WRITE; without them it dry-runs.
 * Filters: Product roles, Europe only (drops design/eng + clearly-US roles). `--sql` emits a
 * seed INSERT (no jd_text) for admin-tooling seeding before the cron is live.
 *
 * Extensible: add tokens to scripts/boards.json; add more ATS fetchers as the pool grows.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isPM, isEU, inferSeniority, stripHtml } from "./job-filters.mjs";
import { sources as atsExtraSources } from "./sources/ats-extra.mjs";
import { sources as bigtechSources } from "./sources/bigtech.mjs";
import { sources as vcSources } from "./sources/vc-startupmap.mjs";

// Board tokens live in boards.json (verified Greenhouse/Lever/Ashby public APIs, sourced from the
// career-ops portals.yml). Dead boards fail non-fatally below; add/curate tokens there, not here.
const __dirname = dirname(fileURLToPath(import.meta.url));
const BOARDS = JSON.parse(readFileSync(join(__dirname, "boards.json"), "utf8"));
const GREENHOUSE_BOARDS = BOARDS.greenhouse;
const LEVER_BOARDS = BOARDS.lever;
const ASHBY_BOARDS = BOARDS.ashby;
const fetchOpts = () => ({ signal: AbortSignal.timeout(20000) }); // fresh signal per call


async function fetchGreenhouse(b) {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${b.token}/jobs?content=true`, fetchOpts());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || [])
    .filter((j) => isPM(j.title))
    .map((j) => {
      const location = (j.location || {}).name || null;
      return {
        company: b.company, title: j.title, url: j.absolute_url, location,
        remote: /remote/i.test(location || "") || /remote/i.test(j.title || ""),
        source: "greenhouse", posted_at: j.updated_at || null,
        jd_text: stripHtml(j.content).slice(0, 8000) || null, seniority: inferSeniority(j.title),
      };
    })
    .filter((j) => isEU(j.location));
}

async function fetchLever(b) {
  const res = await fetch(`https://api.lever.co/v0/postings/${b.token}?mode=json`, fetchOpts());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : [])
    .filter((p) => isPM(p.text))
    .map((p) => {
      const location = (p.categories || {}).location || null;
      return {
        company: b.company, title: p.text, url: p.hostedUrl, location,
        remote: /remote/i.test(location || "") || /remote/i.test(p.text || ""),
        source: "lever", posted_at: p.createdAt ? new Date(p.createdAt).toISOString() : null,
        jd_text: (p.descriptionPlain || "").slice(0, 8000) || null, seniority: inferSeniority(p.text),
      };
    })
    .filter((j) => j.url && isEU(j.location));
}

async function fetchAshby(b) {
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${b.token}`, fetchOpts());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || [])
    .filter((j) => isPM(j.title))
    .map((j) => {
      const location = j.location || null;
      return {
        company: b.company, title: j.title, url: j.jobUrl || j.applyUrl, location,
        remote: !!j.isRemote || /remote/i.test(location || "") || /remote/i.test(j.title || ""),
        source: "ashby", posted_at: j.publishedAt || null,
        jd_text: stripHtml(j.descriptionHtml || j.descriptionPlain).slice(0, 8000) || null,
        seniority: inferSeniority(j.title),
      };
    })
    .filter((j) => j.url && isEU(j.location));
}

// Workable — POST with JSON body, nextPage cursor pagination (page size fixed
// server-side). List endpoint carries NO description (same as ats-extra note).
async function fetchWorkable(b) {
  const all = [];
  let token = null;
  for (let page = 0; page < 20; page++) {
    const res = await fetch(`https://apply.workable.com/api/v3/accounts/${b.token}/jobs`, {
      ...fetchOpts(),
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(token ? { token } : {}),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    for (const j of data.results || []) {
      const loc = j.location || {};
      const location = j.remote
        ? "Remote"
        : [loc.city, loc.region, loc.country].filter(Boolean).join(", ") || null;
      all.push({
        company: b.company, title: j.title || "",
        url: j.shortcode ? `https://apply.workable.com/${b.token}/j/${j.shortcode}/` : "",
        location,
        remote: !!j.remote || /remote/i.test(location || "") || /remote/i.test(j.title || ""),
        source: "workable", posted_at: j.published || null,
        jd_text: null, seniority: inferSeniority(j.title),
      });
    }
    token = data.nextPage;
    if (!token) break;
  }
  return all.filter((j) => j.url && isPM(j.title) && isEU(j.location));
}

// SmartRecruiters — paginated GET, offset until totalFound exhausted. List
// endpoint carries NO description.
async function fetchSmartRecruiters(b) {
  const all = [];
  let offset = 0;
  let total = Infinity;
  for (let page = 0; page < 20 && offset < total; page++) {
    const res = await fetch(
      `https://api.smartrecruiters.com/v1/companies/${b.token}/postings?limit=100&offset=${offset}`,
      fetchOpts(),
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    total = data.totalFound || 0;
    for (const j of data.content || []) {
      const slug = (j.company || {}).identifier || b.token;
      const location =
        (j.location || {}).fullLocation ||
        ((j.location || {}).city ? `${j.location.city}, ${j.location.country || ""}` : null);
      all.push({
        company: b.company, title: j.name || "",
        url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
        location,
        remote: (j.location || {}).remote === true || /remote/i.test(location || "") || /remote/i.test(j.name || ""),
        source: "smartrecruiters", posted_at: j.releasedDate || null,
        jd_text: null, seniority: inferSeniority(j.name),
      });
    }
    offset += 100;
  }
  return all.filter((j) => j.url && isPM(j.title) && isEU(j.location));
}

// Board classes eligible for the vanished-role retirement diff below. Only rows
// whose board was scanned SUCCESSFULLY this run may be retired.
const BOARD_KINDS = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters"];

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dry = !url || !key;
  if (dry) console.error("[dry-run] no SUPABASE_SERVICE_ROLE_KEY set; fetching + logging only, no DB write.");

  const SOURCES = [
    ...GREENHOUSE_BOARDS.map((b) => ({ company: b.company, kind: "greenhouse", run: () => fetchGreenhouse(b) })),
    ...LEVER_BOARDS.map((b) => ({ company: b.company, kind: "lever", run: () => fetchLever(b) })),
    ...ASHBY_BOARDS.map((b) => ({ company: b.company, kind: "ashby", run: () => fetchAshby(b) })),
    ...(BOARDS.workable || []).map((b) => ({ company: b.company, kind: "workable", run: () => fetchWorkable(b) })),
    ...(BOARDS.smartrecruiters || []).map((b) => ({ company: b.company, kind: "smartrecruiters", run: () => fetchSmartRecruiters(b) })),
    ...atsExtraSources,
    ...bigtechSources,
    ...vcSources,
  ];

  let all = [];
  const scannedOk = new Set(); // "Company::kind" of board scans that succeeded
  const CONCURRENCY = 8;
  let idx = 0;
  async function worker() {
    while (idx < SOURCES.length) {
      const s = SOURCES[idx++];
      try {
        const jobs = await s.run();
        if (s.kind) scannedOk.add(`${s.company}::${s.kind}`);
        if (jobs.length) console.error(`${s.company}: ${jobs.length} EU PM role(s)`);
        all.push(...jobs);
      } catch (e) {
        console.error(`${s.company} failed: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // Canonicalize before dedup: tracking suffixes (?lever-source=..., utm) on ATS
  // hosts create duplicate rows under jobs.url UNIQUE — the 01Health/32Co class.
  // Greenhouse is exempt (its embedded boards need ?gh_jid=). Board-class sources
  // are listed first in SOURCES, so on collision the correctly-attributed row wins.
  const STRIP_QUERY_HOSTS = [/(^|\.)lever\.co$/, /(^|\.)ashbyhq\.com$/, /(^|\.)workable\.com$/, /(^|\.)smartrecruiters\.com$/, /(^|\.)breezy\.hr$/];
  const canonUrl = (u) => {
    try {
      const x = new URL(u);
      if (STRIP_QUERY_HOSTS.some((re) => re.test(x.hostname))) { x.search = ""; x.hash = ""; }
      return x.toString();
    } catch { return u; }
  };
  all = all.map((j) => ({ ...j, url: canonUrl(j.url) }));
  const seen = new Set();
  all = all.filter((j) => (seen.has(j.url) ? false : seen.add(j.url)));
  // Drop rows missing a required NOT NULL field. Some scraped sources (e.g. startupmap)
  // occasionally yield a role with no parseable company, which would make the whole
  // batch upsert violate the jobs.company NOT NULL constraint and fail the run.
  const beforeRequired = all.length;
  all = all.filter((j) => j.company && j.title && j.url);
  const dropped = beforeRequired - all.length;
  if (dropped) console.error(`Dropped ${dropped} role(s) missing company/title/url.`);
  console.error(`Total: ${all.length} EU PM roles.`);

  if (process.argv.includes("--sql")) {
    const esc = (s) => (s == null ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'");
    const rows = all
      .map((j) => `(${esc(j.company)}, ${esc(j.title)}, ${esc(j.url)}, ${esc(j.location)}, ${j.remote ? "true" : "false"}, ${esc(j.source)}, ${esc(j.seniority)})`)
      .join(",\n");
    console.log(`INSERT INTO public.jobs (company, title, url, location, remote, source, seniority) VALUES\n${rows}\nON CONFLICT (url) DO NOTHING;`);
    return;
  }
  if (dry) {
    all.slice(0, 40).forEach((j) => console.error(`  ${j.company} - ${j.title} [${j.location}]`));
    return;
  }

  const supabase = createClient(url, key);
  for (let i = 0; i < all.length; i += 500) {
    const { error } = await supabase.from("jobs").upsert(all.slice(i, i + 500), { onConflict: "url" });
    if (error) {
      console.error("Upsert failed:", error.message);
      process.exit(1);
    }
  }
  console.error(`Upserted ${all.length} jobs to the pool.`);

  // Board-diff liveness: a live row whose board class we scanned successfully this
  // run, but whose url no longer appears in the scan, has vanished from the board
  // -> retire it (is_live=false). Rows from non-board sources are never touched.
  const currentUrls = new Set(all.map((j) => j.url));
  const liveRows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("jobs").select("url, company, source")
      .eq("is_live", true).in("source", BOARD_KINDS)
      .range(from, from + 999);
    if (error) { console.error("Liveness select failed:", error.message); break; }
    liveRows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const vanished = liveRows
    .filter((r) => scannedOk.has(`${r.company}::${r.source}`) && !currentUrls.has(r.url))
    .map((r) => r.url);
  for (let i = 0; i < vanished.length; i += 200) {
    const { error } = await supabase
      .from("jobs").update({ is_live: false }).in("url", vanished.slice(i, i + 200));
    if (error) console.error("Retire update failed:", error.message);
  }
  console.error(`Retired ${vanished.length} vanished role(s).`);

  // Link new rows to the companies dimension (name-based, server-side function).
  const { data: linked, error: linkErr } = await supabase.rpc("link_jobs_to_companies");
  if (linkErr) console.error("link_jobs_to_companies failed:", linkErr.message);
  else console.error(`Linked ${linked} job(s) to companies.`);
}

main();
