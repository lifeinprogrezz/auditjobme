#!/usr/bin/env node
/**
 * scripts/jd-backfill.mjs — LLM-FREE JD backfill for the shared `jobs` pool.
 *
 * Many rows arrive from LIST endpoints that carry no description (SmartRecruiters /
 * Workable / Workday list APIs, the consider.com + Getro VC boards, startupmap,
 * Meta/Microsoft big-tech list feeds). Those rows land with jd_text = null and get
 * scored on title alone. This script fills jd_text by routing each row's apply `url`
 * to the correct ATS *detail* API — the per-role endpoint the list call omitted.
 *
 * It is deterministic and LLM-free (no ANTHROPIC_API_KEY, no model call). Idempotent
 * by construction: it only selects rows where jd_text IS NULL, so a filled row is
 * never touched again. Writes are per-row and column-scoped (jd_text + jd_source_detail
 * only) — never an upsert, never clobbering other columns.
 *
 * Env (same contract as scrape.mjs): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to
 * WRITE. Without them it runs in dry mode and logs only (it needs the service role to
 * even SELECT the pool, so no-creds = nothing to do).
 *
 * CLI:  node scripts/jd-backfill.mjs [--dry] [--limit N]
 *   --dry      fetch every detail API + log a per-route breakdown, but write nothing.
 *   --limit N  cap how many jd_text-null rows to attempt (newest first).
 *
 * ATS routes (host-regex dispatch; each fetcher returns a stripped JD string ≤8000
 * chars or null, and NEVER throws — a dead route just leaves jd_text null):
 *   greenhouse · lever · ashby · smartrecruiters · workable · recruitee · personio
 *   · join / teamtailor / workday (best-effort JSON-LD JobPosting.description).
 * Unknown host → null (the role still shows, scored on its title).
 */
import { createClient } from "@supabase/supabase-js";
import { stripHtml } from "./job-filters.mjs";

const fetchOpts = (extra = {}) => ({ signal: AbortSignal.timeout(20000), ...extra }); // fresh signal per call
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const JD_CAP = 8000;

// Trim + cap a stripped JD; empty → null so callers never persist "".
const cap = (s) => {
  const t = (s || "").slice(0, JD_CAP);
  return t || null;
};

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

// Pull a JobPosting.description out of a page's JSON-LD blocks (join / teamtailor /
// workday fallback). Handles a bare object, an array, and an @graph wrapper.
function jsonLdDescription(html) {
  const blocks = [
    ...(html || "").matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  for (const b of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(b[1].trim());
    } catch {
      continue;
    }
    const nodes = [];
    const push = (x) => {
      if (x && typeof x === "object") nodes.push(x);
    };
    if (Array.isArray(parsed)) parsed.forEach(push);
    else {
      push(parsed);
      if (Array.isArray(parsed["@graph"])) parsed["@graph"].forEach(push);
    }
    for (const n of nodes) {
      const t = n["@type"];
      const isJob = t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
      if (isJob && n.description) return n.description;
    }
  }
  return null;
}

// ── Per-ATS detail fetchers (each: browser UA, fetchOpts() timeout, try/catch →
// stripped JD string ≤8000 chars or null; NEVER throw). ───────────────────────

// greenhouse: boards|job-boards.greenhouse.io/{token}/jobs/{id}
//   → GET boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}?content=true → content
async function fetchGreenhouse(url) {
  try {
    let token = null;
    let id = null;
    const m = url.match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
    if (m) {
      token = m[1];
      id = m[2];
    } else {
      // Embedded board variant: /embed/job_app?for={token}&token={id}
      const u = new URL(url);
      token = u.searchParams.get("for");
      id = u.searchParams.get("token");
    }
    if (!token || !id) return null;
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${id}?content=true`,
      fetchOpts({ headers: { "User-Agent": UA, Accept: "application/json" } }),
    );
    if (!res.ok) return null;
    const json = await res.json();
    return cap(stripHtml(json.content));
  } catch {
    return null;
  }
}

// lever: jobs.lever.co/{token}/{id}
//   → GET api.lever.co/v0/postings/{token}/{id}?mode=json → descriptionPlain | description
async function fetchLever(url) {
  try {
    const m = url.match(/lever\.co\/([^/?#]+)\/([^/?#]+)/);
    if (!m) return null;
    const [, token, id] = m;
    const res = await fetch(
      `https://api.lever.co/v0/postings/${token}/${id}?mode=json`,
      fetchOpts({ headers: { "User-Agent": UA, Accept: "application/json" } }),
    );
    if (!res.ok) return null;
    const j = await res.json();
    return cap(j.descriptionPlain || stripHtml(j.description));
  } catch {
    return null;
  }
}

// ashby: jobs.ashbyhq.com/{token}/{id}
//   → GET api.ashbyhq.com/posting-api/job-board/{token} → find posting whose id matches
async function fetchAshby(url) {
  try {
    const m = url.match(/ashbyhq\.com\/([^/?#]+)\/([^/?#]+)/);
    if (!m) return null;
    const [, token, id] = m;
    const res = await fetch(
      `https://api.ashbyhq.com/posting-api/job-board/${token}`,
      fetchOpts({ headers: { "User-Agent": UA, Accept: "application/json" } }),
    );
    if (!res.ok) return null;
    const json = await res.json();
    const posting = (json.jobs || []).find(
      (p) => p.id === id || (p.jobUrl && p.jobUrl.includes(id)) || (p.applyUrl && p.applyUrl.includes(id)),
    );
    if (!posting) return null;
    return cap(stripHtml(posting.descriptionHtml || posting.descriptionPlain));
  } catch {
    return null;
  }
}

// smartrecruiters: jobs|careers.smartrecruiters.com/{company}/{id}[-slug]
//   → GET api.smartrecruiters.com/v1/companies/{company}/postings/{id}
//   → concat every jobAd.sections.*.text (jobDescription/qualifications/additionalInformation)
async function fetchSmartRecruiters(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length < 2) return null;
    const company = segs[0];
    const seg = segs[1];
    const uuid = seg.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    const id = uuid ? uuid[0] : (seg.match(/^\d+/) || [])[0];
    if (!id) return null;
    const res = await fetch(
      `https://api.smartrecruiters.com/v1/companies/${company}/postings/${id}`,
      fetchOpts({ headers: { "User-Agent": UA, Accept: "application/json" } }),
    );
    if (!res.ok) return null;
    const json = await res.json();
    const sections = (json.jobAd || {}).sections || {};
    const parts = [];
    for (const k of Object.keys(sections)) {
      const t = sections[k] && sections[k].text;
      if (t) parts.push(t);
    }
    return cap(stripHtml(parts.join("\n")));
  } catch {
    return null;
  }
}

// workable: apply.workable.com/{account}/j/{shortcode}
//   → GET apply.workable.com/api/v3/accounts/{account}/jobs/{shortcode}
//   → stripHtml(description + requirements + benefits)
async function fetchWorkable(url) {
  try {
    const m = url.match(/workable\.com\/([^/?#]+)\/j\/([^/?#]+)/);
    if (!m) return null;
    const [, account, shortcode] = m;
    const res = await fetch(
      `https://apply.workable.com/api/v3/accounts/${account}/jobs/${shortcode}`,
      fetchOpts({ headers: { "User-Agent": UA, Accept: "application/json" } }),
    );
    if (!res.ok) return null;
    const j = await res.json();
    const html = [j.description, j.requirements, j.benefits].filter(Boolean).join("\n");
    return cap(stripHtml(html));
  } catch {
    return null;
  }
}

// recruitee: {company}.recruitee.com/o/{slug}
//   → GET https://{company}.recruitee.com/api/offers/ → match by slug → description
async function fetchRecruitee(url) {
  try {
    const u = new URL(url);
    const company = u.hostname.split(".")[0];
    const m = u.pathname.match(/\/o\/([^/?#]+)/);
    if (!company || !m) return null;
    const slug = m[1];
    const res = await fetch(
      `https://${company}.recruitee.com/api/offers/`,
      fetchOpts({ headers: { "User-Agent": UA, Accept: "application/json" } }),
    );
    if (!res.ok) return null;
    const json = await res.json();
    const offer = (json.offers || []).find((o) => o.slug === slug || slug.startsWith(o.slug));
    if (!offer) return null;
    return cap(stripHtml(offer.description));
  } catch {
    return null;
  }
}

// personio: {company}.jobs.personio.{de|com}/job/{id}
//   → GET https://{company}.jobs.personio.{tld}/xml → find <position> whose <id> matches
//   → stripHtml its <jobDescriptions>. Fail-open: any parse trouble → null.
async function fetchPersonio(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/job\/(\d+)/);
    if (!m) return null;
    const id = m[1];
    const res = await fetch(
      `${u.origin}/xml`,
      fetchOpts({ headers: { "User-Agent": UA, Accept: "application/xml, text/xml" } }),
    );
    if (!res.ok) return null;
    const xml = await res.text();
    for (const p of xml.matchAll(/<position>([\s\S]*?)<\/position>/gi)) {
      const block = p[1];
      const idm = block.match(/<id>\s*(\d+)\s*<\/id>/i);
      if (idm && idm[1] === id) {
        const dm = block.match(/<jobDescriptions>([\s\S]*?)<\/jobDescriptions>/i);
        if (!dm) return null;
        const inner = dm[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "");
        return cap(stripHtml(inner));
      }
    }
    return null;
  } catch {
    return null;
  }
}

// join / teamtailor / workday: best-effort JSON-LD JobPosting.description from the page.
function makeJsonLd(kind) {
  return async function fetchJsonLd(url) {
    try {
      const res = await fetch(
        url,
        fetchOpts({ headers: { "User-Agent": UA, Accept: "text/html" } }),
      );
      if (!res.ok) return null;
      const desc = jsonLdDescription(await res.text());
      return desc ? cap(stripHtml(desc)) : null;
    } catch {
      return null;
    }
  };
}

// ── Host-regex dispatch ───────────────────────────────────────────────────────
// detectAts(url, source) → { kind, fetch } | null. `source` is a secondary hint;
// the apply URL's host is authoritative (JD-less rows carry ATS-direct apply URLs).
function detectAts(url, source) {
  const host = hostOf(url);
  if (!host) return null;
  if (/(^|\.)greenhouse\.io$/.test(host)) return { kind: "greenhouse", fetch: () => fetchGreenhouse(url) };
  if (/(^|\.)lever\.co$/.test(host)) return { kind: "lever", fetch: () => fetchLever(url) };
  if (/(^|\.)ashbyhq\.com$/.test(host)) return { kind: "ashby", fetch: () => fetchAshby(url) };
  if (/(^|\.)smartrecruiters\.com$/.test(host)) return { kind: "smartrecruiters", fetch: () => fetchSmartRecruiters(url) };
  if (/(^|\.)workable\.com$/.test(host)) return { kind: "workable", fetch: () => fetchWorkable(url) };
  if (/(^|\.)recruitee\.com$/.test(host)) return { kind: "recruitee", fetch: () => fetchRecruitee(url) };
  if (/(^|\.)personio\.(de|com)$/.test(host)) return { kind: "personio", fetch: () => fetchPersonio(url) };
  if (/(^|\.)join\.com$/.test(host)) return { kind: "join", fetch: makeJsonLd("join").bind(null, url) };
  if (/(^|\.)teamtailor\.com$/.test(host)) return { kind: "teamtailor", fetch: makeJsonLd("teamtailor").bind(null, url) };
  if (/\.(myworkdayjobs|myworkdaysite)\.com$/.test(host)) return { kind: "workday", fetch: makeJsonLd("workday").bind(null, url) };
  return null;
}

// ── Orchestration ─────────────────────────────────────────────────────────────
async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dryFlag = process.argv.includes("--dry");
  const limIdx = process.argv.indexOf("--limit");
  const LIMIT = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : null;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[dry-run] no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY set; cannot query the pool, nothing to backfill.");
    return;
  }
  const dry = dryFlag;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Rows that arrived without a JD body. Idempotent by construction — filled rows
  // (jd_text NOT NULL) are never selected, so re-runs only touch the remaining gap.
  let query = supabase
    .from("jobs")
    .select("id, url, source, company")
    .is("jd_text", null)
    .eq("is_live", true)
    .order("first_seen_at", { ascending: false });
  if (LIMIT && Number.isFinite(LIMIT)) query = query.limit(LIMIT);
  const { data: rows, error } = await query;
  if (error) {
    console.error("jd-backfill: select failed —", error.message);
    process.exit(1);
  }
  const targets = rows || [];
  console.error(`jd-backfill: ${targets.length} jd_text-null live row(s)${LIMIT ? ` (limit ${LIMIT})` : ""} · dry=${dry}`);

  // Per-route + per-source tallies so we can see which ATS paths actually work.
  const byKind = {};
  const bySource = {};
  const bump = (obj, key, field) => {
    obj[key] = obj[key] || { attempted: 0, filled: 0 };
    obj[key][field]++;
  };

  const successes = [];
  let attempted = 0;
  let unknown = 0;

  const FETCH_CONCURRENCY = 6;
  let idx = 0;
  async function fetchWorker() {
    while (idx < targets.length) {
      const row = targets[idx++];
      const det = detectAts(row.url, row.source);
      if (!det) {
        unknown++;
        continue;
      }
      attempted++;
      bump(byKind, det.kind, "attempted");
      bump(bySource, row.source || "unknown", "attempted");
      const jd = await det.fetch();
      if (jd) {
        successes.push({ url: row.url, jd_text: jd, jd_source_detail: det.kind });
        bump(byKind, det.kind, "filled");
        bump(bySource, row.source || "unknown", "filled");
      }
    }
  }
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, fetchWorker));

  // Column-scoped per-row writes — NEVER an upsert, never clobbering other columns.
  let wrote = 0;
  if (!dry) {
    let widx = 0;
    async function writeWorker() {
      while (widx < successes.length) {
        const s = successes[widx++];
        const { error: uerr } = await supabase
          .from("jobs")
          .update({ jd_text: s.jd_text, jd_source_detail: s.jd_source_detail })
          .eq("url", s.url);
        if (uerr) console.error(`  update failed for ${s.url}: ${uerr.message}`);
        else wrote++;
      }
    }
    await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, writeWorker));
  }

  // Final summary — attempted, filled, and a per-source/per-kind breakdown.
  console.error(
    `jd-backfill: attempted ${attempted} · filled ${successes.length} · unknown-host ${unknown}` +
      (dry ? " · [dry-run] no writes" : ` · wrote ${wrote}`),
  );
  const fmt = (obj) =>
    Object.keys(obj)
      .sort()
      .map((k) => `    ${k}: ${obj[k].filled}/${obj[k].attempted}`)
      .join("\n");
  if (Object.keys(byKind).length) console.error("  by ATS route (filled/attempted):\n" + fmt(byKind));
  if (Object.keys(bySource).length) console.error("  by source (filled/attempted):\n" + fmt(bySource));
}

main().catch((e) => {
  console.error("jd-backfill: fatal —", e);
  process.exit(1);
});
