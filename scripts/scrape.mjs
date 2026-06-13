#!/usr/bin/env node
/**
 * Daily job scrape -> shared `jobs` pool. v1 sources: Greenhouse + Lever + Ashby public APIs
 * (no auth to read). Run by .github/workflows/scrape.yml (daily cron). Needs SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY (GitHub repo secrets) to WRITE; without them it dry-runs.
 * Filters: Product roles, Europe only (drops design/eng + clearly-US roles). `--sql` emits a
 * seed INSERT (no jd_text) for admin-tooling seeding before the cron is live.
 *
 * Extensible: add tokens to the *_BOARDS arrays; add more ATS fetchers as the pool grows.
 */
import { createClient } from "@supabase/supabase-js";

const GREENHOUSE_BOARDS = [
  { company: "Wallapop", token: "wallapop" },
  { company: "Amplemarket", token: "amplemarket" },
  { company: "GoCardless", token: "gocardless" },
  { company: "Monzo", token: "monzo" },
  { company: "Contentful", token: "contentful" },
  { company: "Typeform", token: "typeform" },
  { company: "SumUp", token: "sumup" },
  { company: "N26", token: "n26" },
  { company: "Celonis", token: "celonis" },
];
const LEVER_BOARDS = [{ company: "FINN", token: "finn" }];
const ASHBY_BOARDS = [
  { company: "Duvo", token: "duvo" },
  { company: "Preply", token: "preply" },
  { company: "LemFi", token: "lemfi" },
  { company: "Linear", token: "linear" },
];

const PM_RE =
  /\b(product manager|product owner|head of product|group product|principal product|lead product|founding product|director of product|vp,? product|product lead)\b/i;
const NEG_RE = /designer|product design|\bengineer(ing)?\b|data scien|\banalyst\b|marketing manager/i;
const EU_RE =
  /europe|emea|united kingdom|\buk\b|ireland|spain|germany|france|netherlands|portugal|sweden|denmark|finland|norway|poland|italy|belgium|austria|switzerland|bulgaria|romania|czech|greece|estonia|lithuania|barcelona|london|berlin|madrid|amsterdam|paris|dublin|munich|lisbon|stockholm|copenhagen|helsinki|oslo|sofia|milan|rome|warsaw|zurich|vienna|brussels|cardiff|manchester|valencia/i;

const isPM = (title) => PM_RE.test(title || "") && !NEG_RE.test(title || "");
const isEU = (location) => !location || EU_RE.test(location);

function inferSeniority(title) {
  const t = (title || "").toLowerCase();
  if (/founding/.test(t)) return "founding";
  if (/principal|lead|head|director|\bvp\b|group/.test(t)) return "lead";
  if (/senior|\bsr\b/.test(t)) return "senior";
  if (/associate|\bapm\b|junior/.test(t)) return "apm";
  return "pm";
}
function stripHtml(s) {
  return (s || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchGreenhouse(b) {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${b.token}/jobs?content=true`);
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
  const res = await fetch(`https://api.lever.co/v0/postings/${b.token}?mode=json`);
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
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${b.token}`);
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
  ];

  let all = [];
  for (const s of SOURCES) {
    try {
      const jobs = await s.run();
      console.error(`${s.company}: ${jobs.length} EU PM role(s)`);
      all = all.concat(jobs);
    } catch (e) {
      console.error(`${s.company} failed: ${e.message}`);
    }
  }
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
