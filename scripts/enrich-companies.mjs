#!/usr/bin/env node
/**
 * Company-context enrichment for the /roles detail panel (Rober 2026-07-06).
 * Fills the two genuinely-missing companies columns — `description` and
 * `founded_year` — and opportunistically null-backfills sector/stage, all
 * GROUNDED: every value is quoted from a source (a JD, the site's og:description,
 * or Wikidata) or left null — never guessed.
 *
 * Per-field source preference:
 *   description  : Haiku over the company's jd_text (if ANTHROPIC_API_KEY) → site og:description
 *   founded_year : Wikidata inception (P571) → Haiku (only if the JD states it)
 *   sector/stage : Haiku over jd_text, written ONLY when the column is currently null
 *
 * Only ever writes columns that are currently NULL — never overwrites the existing
 * pipeline's enrichment. Runs in .github/workflows/scrape.yml (service role).
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to write (dry-runs without).
 * ANTHROPIC_API_KEY is OPTIONAL — the free web + Wikidata sources run without it.
 *
 * Usage: node scripts/enrich-companies.mjs [--limit=150] [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import { makeMeter } from "./usage-meter.mjs";
import {
  MODEL,
  parseEnrichment,
  metaDescription,
  parseWikidataTime,
  linkedinFromHtml,
} from "./enrich-lib.mjs";
import { normalizeHeadcountBucket } from "./headcount-lib.mjs";
import { SECTORS, normalizeSector } from "./sector-lib.mjs";

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
};
const LIMIT = Number(arg("limit", "150")) || 150;
const DRY = process.argv.includes("--dry-run");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const CONCURRENCY = 4;
const JD_CAP = 6000;

const db = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;
const meter = makeMeter(db, "enrich"); // S10: system spend lands in usage_events

async function haikuExtract(company, jd) {
  if (!ANTHROPIC_KEY || !jd) return {};
  const t0 = Date.now();
  const prompt = `From the job description(s) below for the company "${company}", extract ONLY facts that are EXPLICITLY stated. Do not guess or infer beyond the text. Return one JSON object, no prose:
{"description": "<one plain sentence on what the company does, <=200 chars, or null>",
 "sector": "<EXACTLY ONE of these, copied character for character, or null if none fits: ${SECTORS.join(" | ")}>",
 "stage": "<funding stage if stated: seed|series_a|series_b|series_c|series_d|public, else null>",
 "team_size": "<WHOLE-COMPANY headcount if stated, e.g. 51-200 or 340; NOT the size of the hiring team or squad; else null>",
 "founded_year": <integer year if stated, else null>}

---
${jd.slice(0, JD_CAP)}`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    meter.record(MODEL, data?.usage, Date.now() - t0);
    return parseEnrichment(data?.content?.[0]?.text || "");
  } catch {
    return {};
  }
}

async function fetchHomepage(domain) {
  if (!domain) return null;
  try {
    const res = await fetch(`https://${domain}`, {
      redirect: "follow",
      headers: { "user-agent": "northgoing-enrich/1.0 (+https://northgoing.com)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 80000);
  } catch {
    return null;
  }
}

async function wikidataFounded(name) {
  try {
    const s = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=1&format=json&origin=*`,
      { signal: AbortSignal.timeout(12000) },
    );
    const qid = (await s.json())?.search?.[0]?.id;
    if (!qid) return null;
    const e = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json&origin=*`,
      { signal: AbortSignal.timeout(12000) },
    );
    const t = (await e.json())?.entities?.[qid]?.claims?.P571?.[0]?.mainsnak?.datavalue?.value?.time;
    return parseWikidataTime(t);
  } catch {
    return null;
  }
}

async function enrichOne(co) {
  let jd = "";
  if (db) {
    const { data } = await db
      .from("jobs")
      .select("jd_text")
      .eq("company_id", co.slug)
      .not("jd_text", "is", null)
      .limit(3);
    jd = (data ?? []).map((r) => r.jd_text).filter(Boolean).join("\n\n---\n\n");
  }
  // One homepage fetch feeds both the description fallback and the LinkedIn link
  // (companies link their own LinkedIn in the footer).
  const html = co.logo_domain ? await fetchHomepage(co.logo_domain) : null;
  const ai = await haikuExtract(co.name, jd);
  const update = {};
  // The 5 baseline fields every company should carry: website · linkedin · stage
  // · size · founded (Rober 7-06). Each written only when currently missing.
  if ((co.website == null || co.website === "") && co.logo_domain) {
    update.website = `https://${co.logo_domain}`;
  }
  if (co.linkedin_url == null && html) {
    const li = linkedinFromHtml(html);
    if (li) update.linkedin_url = li;
  }
  if (co.description == null) {
    const d = ai.description ?? (html ? metaDescription(html) : null);
    if (d) update.description = d;
  }
  if (co.founded_year == null) {
    const y = (await wikidataFounded(co.name)) ?? ai.founded_year ?? null;
    if (y) update.founded_year = y;
  }
  if (co.sector == null && ai.sector) {
    // The ONE way into sector (issue #70): a free-text model answer becomes a
    // canonical industry or nothing. Writing it raw is how one column ended up
    // carrying 54 strings for 28 industries — Healthtech, Health Tech and
    // Digital Health were three chips for the same thing, and picking one hid
    // the roles filed under the other two.
    const sector = normalizeSector(ai.sector);
    if (sector) update.sector = sector;
  }
  if (co.stage == null && ai.stage) update.stage = ai.stage;
  if (co.headcount_bucket == null && ai.team_size) {
    // The ONE way into headcount_bucket (issue #68 item 6): a free-text model
    // answer becomes a canonical rung or nothing. Writing it raw is how the
    // column ended up carrying two overlapping vocabularies at once.
    const bucket = normalizeHeadcountBucket(ai.team_size);
    if (bucket) update.headcount_bucket = bucket;
  }
  if (Object.keys(update).length === 0) return { slug: co.slug, wrote: null };
  if (!DRY && db) await db.from("companies").update(update).eq("slug", co.slug);
  return { slug: co.slug, wrote: update };
}

async function main() {
  if (!db) {
    console.log("enrich: no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY → dry-run only, nothing written.");
    return;
  }
  const { data: cos, error } = await db
    .from("companies")
    .select(
      "slug, name, logo_domain, website, linkedin_url, description, founded_year, sector, stage, headcount_bucket",
    )
    .or(
      "website.is.null,linkedin_url.is.null,stage.is.null,headcount_bucket.is.null,founded_year.is.null,description.is.null",
    )
    .limit(LIMIT);
  if (error) {
    console.error("enrich: fetch failed —", error.message);
    process.exit(1);
  }
  const targets = cos ?? [];
  console.log(
    `enrich: ${targets.length} companies (limit ${LIMIT}) · anthropic=${ANTHROPIC_KEY ? "on" : "off"} · dry=${DRY}`,
  );
  let wrote = 0;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const results = await Promise.all(targets.slice(i, i + CONCURRENCY).map(enrichOne));
    for (const r of results) {
      if (r.wrote) {
        wrote++;
        console.log(`  ${r.slug}: ${Object.keys(r.wrote).join(", ")}`);
      }
    }
  }
  console.log(`enrich: done — wrote ${wrote}/${targets.length}.`);
  if (!DRY) await meter.flush(); // S10: one bulk insert into usage_events
}

main().catch((e) => {
  console.error("enrich: fatal —", e);
  process.exit(1);
});
