#!/usr/bin/env node
/**
 * Nightly liveness sweep over the immortal-class rows of the shared `jobs` pool
 * (issue #68 items 1 + 5). The scrape's board-diff retires rows that vanish from
 * a re-scanned board feed (BOARD_KINDS), but rows from vc:*, startupmap, workday,
 * factorial, bigtech and seed sources have NO other retirement path — without
 * this sweep they stay is_live=true forever.
 *
 * Verdict logic lives in scripts/liveness-lib.mjs (pinned by
 * src/test/liveness-lib.test.ts): 404/410 + slug-dropping redirects -> dead
 * (is_live=false); 403/5xx/timeout -> unverified, NEVER auto-killed. LinkedIn
 * URLs are never fetched and never killed.
 *
 * Rotation: oldest-checked-first via jobs.liveness_checked_at (nulls first),
 * bounded by --limit, so the whole immortal class cycles across nights.
 *
 * SAFETY: dry-run is the DEFAULT — it checks and reports but writes nothing.
 * Pass --apply to write (the nightly workflow does; manual runs must opt in).
 *
 * Usage:
 *   node scripts/liveness-sweep.mjs                    # dry-run (default)
 *   node scripts/liveness-sweep.mjs --apply            # write retirements
 *   node scripts/liveness-sweep.mjs --limit 500        # sweep more rows
 */
import { createClient } from "@supabase/supabase-js";
import { BOARD_KINDS, checkUrl } from "./liveness-lib.mjs";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const limitIdx = argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(argv[limitIdx + 1], 10) || 200 : 200;
const CONCURRENCY = 8;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("liveness-sweep: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — nothing to sweep.");
  process.exit(0);
}
const supabase = createClient(url, key);

// Live rows whose source class has no board-diff retirement path (or no source
// at all — seed rows), oldest-checked-first so the sweep rotates the whole class.
const { data: rows, error } = await supabase
  .from("jobs")
  .select("id, url, company, title, source, liveness_checked_at")
  .eq("is_live", true)
  .or(`source.is.null,source.not.in.(${BOARD_KINDS.join(",")})`)
  .order("liveness_checked_at", { ascending: true, nullsFirst: true })
  .order("first_seen_at", { ascending: true })
  .limit(LIMIT);
if (error) {
  console.error("liveness-sweep: select failed:", error.message);
  process.exit(1);
}

console.error(`liveness-sweep: checking ${rows.length} immortal-class live row(s)${APPLY ? "" : " (DRY RUN — pass --apply to write)"}`);

const results = new Array(rows.length);
let next = 0;
async function worker() {
  for (;;) {
    const i = next++;
    if (i >= rows.length) return;
    results[i] = await checkUrl(rows[i].url);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const dead = [];
const unverified = [];
let live = 0;
results.forEach((r, i) => {
  if (r.verdict === "dead") dead.push({ ...rows[i], reason: r.reason });
  else if (r.verdict === "unverified") unverified.push({ ...rows[i], reason: r.reason });
  else live++;
});

console.error(`liveness-sweep: live=${live} dead=${dead.length} unverified=${unverified.length}`);
for (const d of dead) {
  console.error(`  dead [${d.source || "seed"}] ${d.company} — ${d.title} (${d.reason})\n       ${d.url}`);
}
if (unverified.length) {
  console.error(`  unverified (never auto-killed): ${unverified.slice(0, 10).map((u) => `${u.company}:${u.reason}`).join(", ")}${unverified.length > 10 ? ` … +${unverified.length - 10}` : ""}`);
}

if (!APPLY) {
  console.error("liveness-sweep: DRY RUN — no writes. Rerun with --apply to retire dead rows.");
  process.exit(0);
}

const now = new Date().toISOString();
const deadIds = dead.map((d) => d.id);
const checkedIds = rows.map((r) => r.id).filter((id) => !deadIds.includes(id));

for (let i = 0; i < deadIds.length; i += 200) {
  const { error: e } = await supabase
    .from("jobs")
    .update({ is_live: false, liveness_checked_at: now })
    .in("id", deadIds.slice(i, i + 200));
  if (e) {
    console.error("liveness-sweep: retire update failed:", e.message);
    process.exit(1);
  }
}
for (let i = 0; i < checkedIds.length; i += 200) {
  const { error: e } = await supabase
    .from("jobs")
    .update({ liveness_checked_at: now })
    .in("id", checkedIds.slice(i, i + 200));
  if (e) {
    console.error("liveness-sweep: checked-at update failed:", e.message);
    process.exit(1);
  }
}
console.error(`liveness-sweep: retired ${deadIds.length} dead row(s); stamped ${checkedIds.length} checked row(s).`);
