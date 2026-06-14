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

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dry = !url || !key;
  if (dry) console.error("[dry-run] no SUPABASE_SERVICE_ROLE_KEY set; fetching + logging only, no DB write.");

  const SOURCES = [
    ...GREENHOUSE_BOARDS.map((b) => ({ company: b.company, run: () => fetchGreenhouse(b) })),
    ...LEVER_BOARDS.map((b) => ({ company: b.company, run: () => fetchLever(b) })),
    ...ASHBY_BOARDS.map((b) => ({ company: b.company, run: () => fetchAshby(b) })),
    ...atsExtraSources,
    ...bigtechSources,
    ...vcSources,
  ];

  let all = [];
  const CONCURRENCY = 8;
  let idx = 0;
  async function worker() {
    while (idx < SOURCES.length) {
      const s = SOURCES[idx++];
      try {
        const jobs = await s.run();
        if (jobs.length) console.error(`${s.company}: ${jobs.length} EU PM role(s)`);
        all.push(...jobs);
      } catch (e) {
        console.error(`${s.company} failed: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const seen = new Set();
  all = all.filter((j) => (seen.has(j.url) ? false : seen.add(j.url)));
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
  const { error } = await supabase.from("jobs").upsert(all, { onConflict: "url" });
  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }
  console.error(`Upserted ${all.length} jobs to the pool.`);
}

main();
