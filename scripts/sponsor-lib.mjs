// UK Home Office "Skilled Worker" sponsor matcher for Northgoing companies.
//
// Ported from career-ops/sponsor-match.mjs (+ the CSV parse of sponsor-fetch.mjs),
// adapted to the app's companies.uk_sponsor_status vocabulary:
//   'licensed'   — the company is a confident match in the Skilled-Worker register
//   'unmatched'  — a real, multi-token company name absent from the register
//   null         — UNCERTAIN (no register data, or a single ambiguous token): never asserted
//
// FAIL-OPEN by design (mirrors career-ops): only a confident register hit yields
// 'licensed'. When in doubt we return null and the UI simply shows no badge — we
// never claim a company can't sponsor off a shaky single-token guess.
//
// Pure + side-effect-free so it unit-tests cleanly (src/test/sponsor-lib.test.ts).

// UK-location signal (a role's location or title). u.k. / UK / United Kingdom + major cities.
export const UK_RE =
  /\b(london|manchester|birmingham|bristol|leeds|edinburgh|glasgow|cambridge|oxford|u\.?k\.?|united kingdom|england|scotland|wales|northern ireland)\b/i;

// Strip legal/suffix tokens so display names and Companies-House legal names align.
const LEGAL_TOKENS = /\b(ltd|limited|plc|llp|inc|llc|lp|holdings?|group|uk|company|com|io)\b/g;

/** Normalize a company name for register matching (lowercase, strip punctuation + legal tokens). */
export function normSponsor(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[.,'&()/]/g, " ")
    .replace(LEGAL_TOKENS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lighter normalizer for alias-map keys (display name → lowercased, punctuation→space). */
export function normCo(c) {
  return (c || "").replace(/[.,'&]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

// ── Register parsing (ported from sponsor-fetch.mjs) ─────────────────────────
/** Minimal CSV line parser (handles quoted fields containing commas). */
export function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Build the Skilled-Worker sponsor set from the register CSV text.
 * Header: Organisation Name,Town/City,County,Type & Rating,Route
 * Returns { swSet, swNames, count } — swNames are the normalized names of orgs
 * whose Route includes "Skilled Worker". Empty set on unparseable input.
 */
export function buildSponsorsFromCsv(csvText) {
  const lines = (csvText || "").split("\n");
  const byNorm = new Map();
  let count = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 5) continue;
    const org = cols[0];
    const route = cols[4];
    const skilledWorker = /skilled worker/i.test(route);
    const norm = normSponsor(org);
    if (!norm) continue;
    count++;
    const prev = byNorm.get(norm);
    if (!prev) byNorm.set(norm, skilledWorker);
    else if (skilledWorker && !prev) byNorm.set(norm, true);
  }
  const swNames = [...byNorm.entries()].filter(([, sw]) => sw).map(([k]) => k);
  return { swSet: new Set(swNames), swNames, count };
}

/**
 * Classify a company against the register → 'licensed' | 'unmatched' | null.
 * @param {string} co             display company name
 * @param {{swSet:Set<string>, swNames:string[]}|null} sponsors  parsed register (null → no data)
 * @param {Record<string,string>} [aliases]  display→legal-name overrides
 */
export function classifySponsor(co, sponsors, aliases) {
  if (!sponsors || !sponsors.swSet) return null; // no register data → uncertain, never assert
  const norm = normSponsor(co);
  if (!norm) return null;
  if (sponsors.swSet.has(norm)) return "licensed"; // exact normalized match
  const aliasLegal = aliases && aliases[normCo(co)]; // display→legal alias, then exact
  if (aliasLegal && sponsors.swSet.has(normSponsor(aliasLegal))) return "licensed";
  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.length >= 2) {
    // multi-token: a 2+-token company name as a leading prefix is a safe match
    // ("plaid financial" for a "plaid financial ltd" register row).
    const prefix = norm + " ";
    for (const k of sponsors.swNames) {
      if (k === norm || k.startsWith(prefix)) return "licensed";
    }
    return "unmatched"; // a real multi-token name genuinely absent from the register
  }
  return null; // single-token name with no exact/alias hit — too risky to declare either way
}

/** Does a role sit in the UK? (its location or title names a UK place.) Drives the
 *  badge gate — a UK-licensed company's non-UK role gets no UK-sponsor badge. */
export function isUkRole(location, title) {
  return UK_RE.test(location || "") || UK_RE.test(title || "");
}
