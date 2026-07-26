/**
 * Pure logic for the board-token sync (scripts/sync-boards.mjs): recognise an
 * applicant-tracking-system board token in a URL, diff what the personal engine
 * has seen against scripts/boards.json, and merge additions back in.
 *
 * No I/O and no network here, so src/test/board-sync-lib.test.ts can pin every
 * rule. The network side (liveness probes, reading the engine's files) lives in
 * sync-boards.mjs. Rule and code move together: change a pattern here only
 * alongside its test.
 */
import { teamtailorHost } from "./sources/teamtailor.mjs";

/**
 * URL -> board token, per applicant-tracking system. Mirrors the detection the
 * personal engine uses when it canonicalises a posting back to its board, plus
 * Teamtailor. Order matters only in that the first match wins.
 */
export const ATS_PATTERNS = {
  greenhouse: [
    /boards\.greenhouse\.io\/([A-Za-z0-9_-]+)/,
    /job-boards(?:\.eu)?\.greenhouse\.io\/([A-Za-z0-9_-]+)/,
    /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/,
  ],
  lever: [/jobs(?:\.eu)?\.lever\.co\/([A-Za-z0-9_-]+)/, /api(?:\.eu)?\.lever\.co\/v0\/postings\/([A-Za-z0-9_-]+)/],
  ashby: [/jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/],
  workable: [/apply\.workable\.com\/([A-Za-z0-9_-]+)/],
  smartrecruiters: [/(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/],
  teamtailor: [/\/\/([A-Za-z0-9-]+)\.teamtailor\.com/],
};

// A Greenhouse/Lever/Ashby path segment that is a route, not a company token.
const NOT_A_TOKEN = /^(embed|jobs|job|search|v1|api|www|app|careers|share)$/i;

/** First recognised board in a URL, or null. `token` is the board slug. */
export function detectBoard(url) {
  const u = String(url || "");
  for (const [ats, patterns] of Object.entries(ATS_PATTERNS)) {
    for (const p of patterns) {
      const m = u.match(p);
      if (!m) continue;
      let token;
      try {
        token = decodeURIComponent(m[1]);
      } catch {
        token = m[1];
      }
      if (NOT_A_TOKEN.test(token)) continue;
      return { ats, token };
    }
  }
  return null;
}

/**
 * Teamtailor career sites are very often served from a company's own domain
 * (careers.macadam.app), where nothing in the hostname says "Teamtailor". The
 * giveaway is the posting path: /jobs/{numeric-id}-{slug}, optionally behind a
 * two-letter locale segment. That is a CANDIDATE only. sync-boards.mjs confirms
 * it by fetching /jobs.json and checking it really is a Teamtailor feed, so a
 * false positive costs one request and is discarded.
 */
export function teamtailorCandidateHost(url) {
  const m = String(url || "").match(
    /^https?:\/\/([A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,})\/(?:[a-z]{2}\/)?jobs\/\d{4,}-/,
  );
  if (!m) return null;
  const host = m[1].toLowerCase();
  if (/(^|\.)teamtailor\.com$/.test(host)) return null; // already covered by ATS_PATTERNS
  return host;
}

/** Stable identity of a board entry inside one applicant-tracking system. */
export function boardKey(ats, entry) {
  if (ats === "teamtailor") return teamtailorHost(entry).toLowerCase();
  return String(entry.token || "").toLowerCase();
}

/** boards.json -> { ats: Set<key> } of everything the product already scrapes. */
export function indexBoards(boards) {
  const index = {};
  for (const [ats, list] of Object.entries(boards || {})) {
    if (!Array.isArray(list)) continue; // skips "_comment"
    index[ats] = new Set(list.map((e) => boardKey(ats, e)));
  }
  return index;
}

/**
 * Boards the engine knows and the product does not. `discovered` entries are
 * `{ ats, company, token? , host? }`. Deduped by key, first company name wins,
 * and the result is sorted so a report reads the same way twice.
 */
export function diffBoards(boards, discovered) {
  const index = indexBoards(boards);
  const missing = new Map();
  for (const d of discovered || []) {
    if (!d || !d.ats) continue;
    const key = boardKey(d.ats, d);
    if (!key) continue;
    const known = index[d.ats];
    if (known && known.has(key)) continue;
    const id = `${d.ats}::${key}`;
    if (missing.has(id)) {
      // Keep the first non-empty company name we saw for this board.
      const kept = missing.get(id);
      if (!kept.company && d.company) kept.company = d.company;
      continue;
    }
    missing.set(id, { ...d });
  }
  return [...missing.values()].sort(
    (a, b) => a.ats.localeCompare(b.ats) || boardKey(a.ats, a).localeCompare(boardKey(b.ats, b)),
  );
}

/**
 * Merge additions into a boards.json object. Returns a NEW object (the input is
 * untouched) plus the entries actually added. Idempotent: re-running with the
 * same additions adds nothing, which is what makes the monthly run safe.
 */
export function mergeIntoBoards(boards, additions) {
  const next = { ...(boards || {}) };
  const added = [];
  for (const a of additions || []) {
    if (!a || !a.ats) continue;
    const list = Array.isArray(next[a.ats]) ? [...next[a.ats]] : [];
    const key = boardKey(a.ats, a);
    if (!key || list.some((e) => boardKey(a.ats, e) === key)) continue;
    const entry = { company: a.company || key };
    if (a.host) entry.host = a.host;
    else entry.token = a.token;
    list.push(entry);
    next[a.ats] = list;
    added.push({ ats: a.ats, ...entry });
  }
  return { boards: next, added };
}

/**
 * One `- [ ] [4.2] URL | Company | Role | ...` row of the engine's pipeline file.
 * Returns null for headings, blank lines and anything without a URL.
 */
export function parsePipelineRow(line) {
  const m = String(line || "").match(/^\s*-\s*\[[ xX]\]\s*(?:\[[^\]]*\]\s*)?(https?:\/\/\S+)\s*\|\s*([^|]+?)\s*\|/);
  if (!m) return null;
  return { url: m[1], company: m[2].trim() || null };
}
