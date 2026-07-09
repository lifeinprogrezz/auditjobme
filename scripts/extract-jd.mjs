#!/usr/bin/env node
/**
 * JD structured-data extraction pass (Rober 2026-07-09). Reads jobs.jd_text and
 * writes a role-level structured-facts JSONB to jobs.extraction, plus the version
 * + content-hash bookkeeping columns (migration 20260709150000_jd_extraction_columns).
 *
 * HYBRID per role: a free regex pre-pass (heuristicExtract) + ONE Haiku call
 * (direct POST to api.anthropic.com, mirroring scripts/enrich-companies.mjs).
 * The deterministic heuristic wins for salary + yoe_min; the LLM fills the rest.
 *
 * FAIL-OPEN: with no ANTHROPIC_API_KEY the run is heuristic-only (never blocks).
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to write (nothing to do without them).
 * ANTHROPIC_KEY spends OUTSIDE the app's proxy kill-switch, so a HARD ceiling of
 * 1200 Haiku calls per run is enforced.
 *
 * Usage: node scripts/extract-jd.mjs [--dry] [--limit N]
 *   --dry     compute + log, do NOT write to the DB (still calls Haiku, like enrich --dry-run)
 *   --limit N cap the number of stale rows processed this run
 */
import { createClient } from "@supabase/supabase-js";
import {
  EXTRACTION_VERSION,
  MODEL,
  jdHash,
  heuristicExtract,
  buildExtractionMessages,
  parseExtraction,
  mergeExtraction,
} from "./extract-lib.mjs";

const DRY = process.argv.includes("--dry");
const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) || 0 : 0;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const CONCURRENCY = 4;
const MIN_JD_LEN = 60;
const MAX_LLM_CALLS = 1200; // hard ceiling — this key spends outside the proxy kill-switch

const db = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;

async function haikuExtract(jdText, heur) {
  const { system, user } = buildExtractionMessages(jdText, heur);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return {};
    return parseExtraction(await res.json());
  } catch {
    return {};
  }
}

async function main() {
  if (!db) {
    console.error("extract: no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY set → nothing to do.");
    return;
  }

  // Fetch every row with a jd_text (small column set), then filter to stale rows
  // in JS — the jd_hash comparison can't run in SQL. Paginate to bound memory.
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("jobs")
      .select("id, jd_text, extraction_version, jd_hash")
      .not("jd_text", "is", null)
      .range(from, from + 999);
    if (error) {
      console.error("extract: fetch failed —", error.message);
      process.exit(1);
    }
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  // Stale = version bumped OR jd_text edited since last extract.
  let targets = rows.filter(
    (r) =>
      r.jd_text &&
      r.jd_text.length > MIN_JD_LEN &&
      (r.extraction_version !== EXTRACTION_VERSION || r.jd_hash !== jdHash(r.jd_text)),
  );

  if (LIMIT > 0) targets = targets.slice(0, LIMIT);

  // Bound Haiku spend: never exceed the call ceiling in one run.
  if (ANTHROPIC_KEY && targets.length > MAX_LLM_CALLS) {
    console.error(
      `extract: ${targets.length} stale rows exceed the ${MAX_LLM_CALLS}-call ceiling — processing the first ${MAX_LLM_CALLS} this run; the rest extract next run.`,
    );
    targets = targets.slice(0, MAX_LLM_CALLS);
  }

  console.error(
    `extract: ${targets.length} stale row(s) · anthropic=${ANTHROPIC_KEY ? "on" : "off"} · dry=${DRY} · v=${EXTRACTION_VERSION}`,
  );

  let idx = 0;
  let extracted = 0;
  let llmCalls = 0;
  let hitCeiling = false;
  const samples = [];

  async function worker() {
    while (idx < targets.length && !hitCeiling) {
      const row = targets[idx++];
      if (!row.jd_text) continue;

      const heur = heuristicExtract(row.jd_text);
      let llm = {};
      if (ANTHROPIC_KEY) {
        if (llmCalls >= MAX_LLM_CALLS) {
          hitCeiling = true;
          break;
        }
        llmCalls++;
        llm = await haikuExtract(row.jd_text, heur);
      }
      const extraction = mergeExtraction(heur, llm);

      if (!DRY) {
        const { error } = await db
          .from("jobs")
          .update({
            extraction,
            extraction_version: EXTRACTION_VERSION,
            jd_hash: jdHash(row.jd_text),
            extracted_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (error) {
          console.error(`  ${row.id}: update failed — ${error.message}`);
          continue;
        }
      }
      extracted++;
      if (samples.length < 3) samples.push({ id: row.id, extraction });
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (hitCeiling) {
    console.error(`extract: HARD ceiling of ${MAX_LLM_CALLS} Haiku calls hit — stopped; remaining stale rows extract next run.`);
  }
  console.error(
    `extract: done — extracted ${extracted}/${targets.length} · llm-calls ${llmCalls} · dry=${DRY}.`,
  );
  for (const s of samples) {
    console.error(`  sample ${s.id}: ${JSON.stringify(s.extraction)}`);
  }
}

main().catch((e) => {
  console.error("extract: fatal —", e);
  process.exit(1);
});
