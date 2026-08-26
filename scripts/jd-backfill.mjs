#!/usr/bin/env node
/**
 * scripts/jd-backfill.mjs — LLM-FREE JD backfill for the shared `jobs` pool.
 *
 * Many rows arrive from LIST endpoints that carry no description (SmartRecruiters /
 * Workable / Workday list APIs, the Getro VC boards, startupmap, scaling-europe,
 * Meta/Microsoft big-tech list feeds). Since issue #130 a row with no readable
 * jd_text is never scored, so every blank row here is a role the product cannot
 * rank until this script fills it (issue #143). It routes each row's apply `url`
 * to the correct ATS *detail* endpoint — the per-role call the list omitted.
 *
 * Deterministic and LLM-free (no ANTHROPIC_API_KEY, no model call). Idempotent by
 * construction: it selects only rows whose jd_text is null or empty, so a filled row
 * is never touched again. Writes are per-row and column-scoped (jd_text +
 * jd_source_detail only) — never an upsert, never clobbering other columns.
 * Fail-soft per row: a dead endpoint leaves that row blank and is counted as failed.
 *
 * Bounded: BACKFILL_LIMIT rows per run (300), NEWEST first — a role scraped this
 * morning gets its JD today and scores on the next backlog tick; the older tail
 * catches up over the following daily runs.
 *
 * Board sources (startupmap, scaling-europe, vc:*) store a board link that
 * redirects to the employer's ATS. For those rows ONLY, the URL is followed once
 * (redirects, no body read) and the final host is routed like any other row. An
 * unknown final host is reported as unsupported — never scraped as generic HTML.
 *
 * Env (same contract as scrape.mjs): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to
 * WRITE. Without them it runs in dry mode and logs only (it needs the service role to
 * even SELECT the pool, so no-creds = nothing to do).
 *
 * CLI:  node scripts/jd-backfill.mjs [--dry] [--limit N]
 *   --dry      fetch every detail endpoint + log the breakdown, but write nothing.
 *   --limit N  override the per-run cap (default BACKFILL_LIMIT).
 *
 * Pure logic (routing, id parsing, extraction, tallies) lives in jd-backfill-lib.mjs,
 * pinned by jd-backfill-lib.test.mjs. This file owns fetch + Supabase only.
 */
import { createClient } from "@supabase/supabase-js";
import {
  BACKFILL_LIMIT,
  ashbyRef,
  atsKindOf,
  extractAshby,
  extractGreenhouse,
  extractJsonLd,
  extractLever,
  extractPersonio,
  extractRecruitee,
  extractSmartRecruiters,
  extractWorkable,
  greenhouseRef,
  isReadableJd,
  leverRef,
  newTally,
  personioRef,
  recruiteeRef,
  shouldFollow,
  smartRecruitersRef,
  summaryLine,
} from "./jd-backfill-lib.mjs";

const fetchOpts = (extra = {}) => ({ signal: AbortSignal.timeout(20000), ...extra }); // fresh signal per call
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const JSON_HEADERS = { "User-Agent": UA, Accept: "application/json" };
const HTML_HEADERS = { "User-Agent": UA, Accept: "text/html" };

async function getJson(url) {
  const res = await fetch(url, fetchOpts({ headers: JSON_HEADERS }));
  return res.ok ? res.json() : null;
}

async function getText(url, accept = HTML_HEADERS) {
  const res = await fetch(url, fetchOpts({ redirect: "follow", headers: accept }));
  return res.ok ? res.text() : null;
}

// ── Per-ATS detail fetchers: fetch + the lib's extractor. Each returns a stripped
// JD string ≤ JD_CAP or null. Errors propagate to the caller, which counts them. ──
const FETCHERS = {
  greenhouse: async (url) => {
    const ref = greenhouseRef(url);
    if (!ref) return null;
    return extractGreenhouse(
      await getJson(`https://boards-api.greenhouse.io/v1/boards/${ref.token}/jobs/${ref.id}?content=true`),
    );
  },
  lever: async (url) => {
    const ref = leverRef(url);
    if (!ref) return null;
    return extractLever(await getJson(`https://api.lever.co/v0/postings/${ref.token}/${ref.id}?mode=json`));
  },
  ashby: async (url) => {
    const ref = ashbyRef(url);
    if (!ref) return null;
    return extractAshby(await getJson(`https://api.ashbyhq.com/posting-api/job-board/${ref.token}`), ref.id);
  },
  smartrecruiters: async (url) => {
    const ref = smartRecruitersRef(url);
    if (!ref) return null;
    return extractSmartRecruiters(
      await getJson(`https://api.smartrecruiters.com/v1/companies/${ref.company}/postings/${ref.id}`),
    );
  },
  workable: async (url) => extractWorkable(await getText(url)),
  recruitee: async (url) => {
    const ref = recruiteeRef(url);
    if (!ref) return null;
    return extractRecruitee(await getJson(`https://${ref.company}.recruitee.com/api/offers/`), ref.slug);
  },
  personio: async (url) => {
    const ref = personioRef(url);
    if (!ref) return null;
    return extractPersonio(
      await getText(`${ref.origin}/xml`, { "User-Agent": UA, Accept: "application/xml, text/xml" }),
      ref.id,
    );
  },
  join: async (url) => extractJsonLd(await getText(url)),
  teamtailor: async (url) => extractJsonLd(await getText(url)),
  workday: async (url) => extractJsonLd(await getText(url)),
};

/** Follow a board link's redirects once and return the final URL (body discarded).
 *  Null on any failure. Used ONLY for shouldFollow sources. */
async function resolveFinalUrl(url) {
  try {
    const res = await fetch(url, fetchOpts({ redirect: "follow", headers: HTML_HEADERS }));
    try {
      await res.body?.cancel();
    } catch {
      /* body already consumed or absent */
    }
    return res.url || null;
  } catch {
    return null;
  }
}

/** Decide the route for one row: { kind, url, followed } or null (unsupported). */
async function routeRow(row) {
  const direct = atsKindOf(row.url);
  if (direct) return { kind: direct, url: row.url, followed: false };
  if (!shouldFollow(row.source)) return null;
  const finalUrl = await resolveFinalUrl(row.url);
  const kind = finalUrl ? atsKindOf(finalUrl) : null;
  return kind ? { kind, url: finalUrl, followed: true } : null;
}

// ── Orchestration ─────────────────────────────────────────────────────────────
async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dry = process.argv.includes("--dry");
  const limIdx = process.argv.indexOf("--limit");
  const parsed = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : NaN;
  const LIMIT = Number.isFinite(parsed) && parsed > 0 ? parsed : BACKFILL_LIMIT;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[dry-run] no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY set; cannot query the pool, nothing to backfill.");
    return;
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Live rows with no readable body (null OR empty). Idempotent: a filled row is
  // never selected again. Newest first, capped — see the header for why.
  const { data: rows, error } = await supabase
    .from("jobs")
    .select("id, url, source, company")
    .or("jd_text.is.null,jd_text.eq.")
    .eq("is_live", true)
    .order("first_seen_at", { ascending: false })
    .limit(LIMIT);
  if (error) {
    console.error("jd-backfill: select failed —", error.message);
    process.exit(1);
  }
  const targets = rows || [];
  const tally = newTally();
  tally.selected = targets.length;
  console.error(`jd-backfill: ${targets.length} blank live row(s) selected (cap ${LIMIT}, newest first) · dry=${dry}`);

  // Per-route + per-source tallies so we can see which ATS paths actually work.
  const byKind = {};
  const bySource = {};
  const bump = (obj, key, field) => {
    obj[key] = obj[key] || { attempted: 0, filled: 0 };
    obj[key][field]++;
  };

  const successes = [];
  const FETCH_CONCURRENCY = 6;
  let idx = 0;
  async function fetchWorker() {
    while (idx < targets.length) {
      const row = targets[idx++];
      const route = await routeRow(row);
      if (!route) {
        tally.unsupported++;
        continue;
      }
      if (route.followed) tally.followed++;
      tally.attempted++;
      bump(byKind, route.kind, "attempted");
      bump(bySource, row.source || "unknown", "attempted");
      let jd = null;
      try {
        jd = await FETCHERS[route.kind](route.url);
      } catch {
        jd = null; // fail-soft: this row stays blank, counted below
      }
      if (isReadableJd(jd)) {
        successes.push({ id: row.id, jd_text: jd, jd_source_detail: route.kind });
        tally.filled++;
        bump(byKind, route.kind, "filled");
        bump(bySource, row.source || "unknown", "filled");
      } else {
        tally.failed++;
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
          .eq("id", s.id);
        if (uerr) console.error(`  update failed for ${s.id}: ${uerr.message}`);
        else wrote++;
      }
    }
    await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, writeWorker));
  }

  console.error(summaryLine(tally, { dry, wrote }));
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
