#!/usr/bin/env node
/**
 * Daily job scrape -> shared `jobs` pool. v1 source: Greenhouse public boards-api (no auth to read).
 * Run by .github/workflows/scrape.yml (daily cron). Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * (GitHub repo secrets) to WRITE; without them it dry-runs (fetch + log, no DB write).
 *
 * Extensible: add board tokens to GREENHOUSE_BOARDS, and add other ATS fetchers (Lever, Ashby,
 * SmartRecruiters, ...) alongside fetchGreenhouse as the pool grows. This is the v1 port of the
 * career-ops multi-ATS scan; it starts with one reliable public source + the ICP filters
 * (Product roles, Europe only).
 */
import { createClient } from "@supabase/supabase-js";

// company display name : Greenhouse board token (probed live to return EU PM roles)
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

const PM_RE =
  /\b(product manager|product owner|head of product|group product|principal product|lead product|founding product|director of product|vp,? product|product lead)\b/i;
// exclude adjacent-but-not-PM roles that the broad PM_RE would otherwise catch
const NEG_RE = /designer|product design|\bengineer(ing)?\b|data scien|\banalyst\b|marketing manager/i;

// Europe-only ICP. Keep if the location names a European place / Europe / EMEA (or is unknown);
// drop clearly non-European locations (e.g. US-only roles).
const EU_RE =
  /europe|emea|united kingdom|\buk\b|ireland|spain|germany|france|netherlands|portugal|sweden|denmark|finland|norway|poland|italy|belgium|austria|switzerland|bulgaria|romania|czech|greece|estonia|lithuania|barcelona|london|berlin|madrid|amsterdam|paris|dublin|munich|lisbon|stockholm|copenhagen|helsinki|oslo|sofia|milan|rome|warsaw|zurich|vienna|brussels|cardiff|manchester|valencia/i;

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

async function fetchGreenhouse(board) {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board.token}/jobs?content=true`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || [])
    .filter((j) => PM_RE.test(j.title || "") && !NEG_RE.test(j.title || ""))
    .map((j) => {
      const location = (j.location || {}).name || null;
      return {
        company: board.company,
        title: j.title,
        url: j.absolute_url,
        location,
        remote: /remote/i.test(location || "") || /remote/i.test(j.title || ""),
        source: "greenhouse",
        posted_at: j.updated_at || null,
        jd_text: stripHtml(j.content).slice(0, 8000) || null,
        seniority: inferSeniority(j.title),
      };
    })
    .filter((j) => !j.location || EU_RE.test(j.location)); // Europe-only ICP
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dry = !url || !key;
  if (dry) console.log("[dry-run] no SUPABASE_SERVICE_ROLE_KEY set; fetching + logging only, no DB write.");

  let all = [];
  for (const b of GREENHOUSE_BOARDS) {
    try {
      const jobs = await fetchGreenhouse(b);
      console.log(`${b.company}: ${jobs.length} EU PM role(s)`);
      all = all.concat(jobs);
    } catch (e) {
      console.error(`${b.company} failed: ${e.message}`);
    }
  }
  // dedup by url within this run (a role can list on multiple boards/locations)
  const seen = new Set();
  all = all.filter((j) => (seen.has(j.url) ? false : seen.add(j.url)));
  console.log(`Total: ${all.length} EU PM roles.`);
  if (process.argv.includes("--sql")) {
    // Emit an idempotent INSERT (no jd_text) so the pool can be seeded via admin tooling
    // before the cron + service-role key are live. The cron path (below) writes the full row.
    const esc = (s) => (s == null ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'");
    const rows = all
      .map((j) => `(${esc(j.company)}, ${esc(j.title)}, ${esc(j.url)}, ${esc(j.location)}, ${j.remote ? "true" : "false"}, ${esc(j.source)}, ${esc(j.seniority)})`)
      .join(",\n");
    console.log(`INSERT INTO public.jobs (company, title, url, location, remote, source, seniority) VALUES\n${rows}\nON CONFLICT (url) DO NOTHING;`);
    return;
  }
  if (dry) {
    all.slice(0, 30).forEach((j) => console.log(`  ${j.company} - ${j.title} [${j.location}]`));
    return;
  }

  const supabase = createClient(url, key);
  // upsert on url: new roles inserted, existing refreshed. first_seen_at/is_live/created_at keep
  // their values (not in the payload), so they survive re-scrapes.
  const { error } = await supabase.from("jobs").upsert(all, { onConflict: "url" });
  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }
  console.log(`Upserted ${all.length} jobs to the pool.`);
}

main();
