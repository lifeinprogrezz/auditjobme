#!/usr/bin/env node
/**
 * sync-boards.mjs — keep scripts/boards.json caught up with the board tokens the
 * personal career-ops engine has already discovered.
 *
 * The engine resolves postings back to their applicant-tracking system every
 * night, so it learns about new company boards long before the product does. On
 * 2026-07-25 that diff was done by hand (25 unknown tokens, 15 still alive, added
 * manually). This is that job, re-runnable and idempotent, meant for a monthly run.
 *
 * What it does:
 *   1. reads the engine's data files as plain text and pulls every board URL out
 *   2. recognises the token per applicant-tracking system (board-sync-lib.mjs)
 *   3. drops everything scripts/boards.json already knows
 *   4. verifies each remaining board is still alive against its public endpoint
 *   5. reports, or with --write adds the live ones to scripts/boards.json
 *
 * The engine directory is READ ONLY. Nothing here writes outside this repo.
 *
 * Usage:
 *   node scripts/sync-boards.mjs --engine=/path/to/career-ops
 *   node scripts/sync-boards.mjs --engine=... --ats=teamtailor --write
 *   CAREER_OPS_DIR=/path/to/career-ops node scripts/sync-boards.mjs
 *
 * Flags:
 *   --engine=DIR   the career-ops checkout (or set CAREER_OPS_DIR)
 *   --ats=NAME     only this applicant-tracking system (repeatable, comma-separated)
 *   --limit=N      cap how many candidates get probed this run (default 500)
 *   --min-jobs=N   only count a board live if it has at least N openings (default 0)
 *   --write        write the live additions into scripts/boards.json
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectBoard,
  teamtailorCandidateHost,
  diffBoards,
  mergeIntoBoards,
  parsePipelineRow,
  boardKey,
} from "./board-sync-lib.mjs";
import { isTeamtailorFeed, teamtailorFeedUrl } from "./sources/teamtailor.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOARDS_PATH = join(__dirname, "boards.json");

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const WRITE = argv.includes("--write");
const LIMIT = Number(flag("limit", "500")) || 500;
const MIN_JOBS = Number(flag("min-jobs", "0")) || 0;
const ONLY = (flag("ats") || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const ENGINE = flag("engine") || process.env.CAREER_OPS_DIR;
if (!ENGINE) {
  console.error(
    "Point this at your career-ops checkout: --engine=/path/to/career-ops (or set CAREER_OPS_DIR).\n" +
      "The directory is only ever read, never written.",
  );
  process.exit(2);
}
if (!existsSync(ENGINE)) {
  console.error(`No such directory: ${ENGINE}`);
  process.exit(2);
}

// Engine files worth reading. Plain text on purpose: URLs are extracted with a
// regex, so this needs no YAML parser and no dependency on the engine's layout.
const ENGINE_FILES = [
  "portals.yml",
  "data/pipeline.md",
  "data/startupmap_discovered.yml",
  "data/ready-to-apply.md",
  "data/not-applying.md",
  "data/applications.md",
];

/** Every board the engine has ever seen, as `{ ats, company, token|host }`. */
function readEngineBoards(dir) {
  const found = [];
  const seenFiles = [];
  for (const rel of ENGINE_FILES) {
    const path = join(dir, rel);
    if (!existsSync(path)) continue;
    seenFiles.push(rel);
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      // pipeline rows carry a company name next to the url; everything else is
      // a bare url and gets its name from the board's own feed at probe time.
      const row = parsePipelineRow(line);
      const company = row ? row.company : null;
      for (const m of line.matchAll(/https?:\/\/[^\s"'|)<>\]]+/g)) {
        const url = m[0].replace(/[.,;]+$/, "");
        const board = detectBoard(url);
        if (board) {
          found.push({ ...board, company });
          continue;
        }
        const host = teamtailorCandidateHost(url);
        if (host) found.push({ ats: "teamtailor", host, company });
      }
    }
  }
  return { found, seenFiles };
}

// ── liveness probes: one public endpoint per applicant-tracking system ───────
const fetchOpts = (extra = {}) => ({ signal: AbortSignal.timeout(15000), ...extra });
const jsonPost = (body) =>
  fetchOpts({
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

const PROBES = {
  async greenhouse(e) {
    const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${e.token}/jobs`, fetchOpts());
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    // The board root carries the company's own display name ("Freenow by Lyft"),
    // which beats guessing at the capitalisation of a url token.
    let name = null;
    try {
      const meta = await fetch(`https://boards-api.greenhouse.io/v1/boards/${e.token}`, fetchOpts());
      if (meta.ok) name = String((await meta.json()).name || "").trim() || null;
    } catch {
      // name is a nicety, never a reason to call a live board dead
    }
    return { jobs: (d.jobs || []).length, name };
  },
  async lever(e) {
    let r = await fetch(`https://api.lever.co/v0/postings/${e.token}?mode=json`, fetchOpts());
    if (r.status === 404) r = await fetch(`https://api.eu.lever.co/v0/postings/${e.token}?mode=json`, fetchOpts());
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (!Array.isArray(d)) throw new Error("not a postings array");
    return { jobs: d.length };
  },
  async ashby(e) {
    const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${e.token}`, fetchOpts());
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return { jobs: (d.jobs || []).length };
  },
  async workable(e) {
    const r = await fetch(`https://apply.workable.com/api/v3/accounts/${e.token}/jobs`, jsonPost({}));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return { jobs: (d.results || []).length };
  },
  async smartrecruiters(e) {
    const r = await fetch(
      `https://api.smartrecruiters.com/v1/companies/${e.token}/postings?limit=1`,
      fetchOpts(),
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const name = String(((d.content || [])[0] || {}).company?.name || "").trim() || null;
    return { jobs: d.totalFound || 0, name };
  },
  async teamtailor(e) {
    const r = await fetch(teamtailorFeedUrl(e), fetchOpts({ headers: { Accept: "application/json" } }));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (!isTeamtailorFeed(d)) throw new Error("not a Teamtailor jobs.json feed");
    return { jobs: d.items.length, name: String(d.title || "").trim() || null };
  },
};

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

async function main() {
  const boards = JSON.parse(readFileSync(BOARDS_PATH, "utf8"));
  const { found, seenFiles } = readEngineBoards(ENGINE);
  const scoped = ONLY.length ? found.filter((f) => ONLY.includes(f.ats)) : found;
  const missing = diffBoards(boards, scoped);

  console.log(`Engine: ${ENGINE}`);
  console.log(`Read ${seenFiles.length} file(s): ${seenFiles.join(", ")}`);
  console.log(`Board references found: ${scoped.length}`);
  console.log(`Not in boards.json: ${missing.length}`);
  if (!missing.length) {
    console.log("Nothing to add. The product list is caught up with the engine.");
    return;
  }

  const probing = missing.slice(0, LIMIT);
  if (missing.length > probing.length) {
    console.log(`Probing the first ${probing.length} (raise with --limit=N).`);
  }

  const results = await mapLimit(probing, 6, async (e) => {
    try {
      const r = await PROBES[e.ats](e);
      return { entry: e, ...r };
    } catch (err) {
      return { entry: e, dead: err.message };
    }
  });

  const live = results.filter((r) => !r.dead && r.jobs >= MIN_JOBS);
  const dead = results.filter((r) => r.dead);

  console.log(`\nLive: ${live.length}   Dead or unreachable: ${dead.length}`);
  for (const r of live) {
    const e = r.entry;
    console.log(`  live   ${e.ats.padEnd(16)} ${boardKey(e.ats, e).padEnd(44)} ${r.jobs} opening(s)  ${e.company || r.name || ""}`);
  }
  for (const r of dead) {
    console.log(`  dead   ${r.entry.ats.padEnd(16)} ${boardKey(r.entry.ats, r.entry).padEnd(44)} ${r.dead}`);
  }

  if (!WRITE) {
    console.log(`\nReport only. Re-run with --write to add the ${live.length} live board(s) to scripts/boards.json.`);
    return;
  }

  const additions = live.map((r) => ({ ...r.entry, company: r.entry.company || r.name || null }));
  const { boards: next, added } = mergeIntoBoards(boards, additions);
  if (!added.length) {
    console.log("\nboards.json already had every live board. Nothing written.");
    return;
  }
  writeFileSync(BOARDS_PATH, JSON.stringify(next, null, 1) + "\n");
  console.log(`\nAdded ${added.length} board(s) to scripts/boards.json.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
