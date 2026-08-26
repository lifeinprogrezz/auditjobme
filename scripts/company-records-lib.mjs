// Pure helpers for scripts/company-records.mjs (issue #153, item B1): create a
// `companies` row for every distinct company name on live jobs that lacks one.
// No network, no DB -- pinned by scripts/company-records-lib.test.mjs.

/**
 * Company name -> slug, matching the convention already live in `companies.slug`
 * (delivery_hero, mistral_ai, weflow_getweflow_com -- rows created by hand before
 * this script existed, sources 'tracked' and 'autolink'): lowercase, diacritics
 * folded, every run of non-alphanumeric characters collapsed to ONE underscore,
 * no leading/trailing underscore.
 *
 * Deliberately NOT companyKey() (src/lib/connections.ts / scripts/headcount-lib.mjs)
 * -- those strip legal-entity suffixes and drop separators entirely for FUZZY
 * cross-source matching, a different job from deriving a stable, readable
 * primary key from one name that is already the canonical spelling.
 */
export function slugForCompany(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Group job rows by the EXACT lower(company) key -- the same key
 * public.link_jobs_to_companies() matches on (`where lower(j.company) = b.lname`),
 * so a row this script creates is linkable by that RPC on the very next scrape
 * (and by this script's own end-of-run call to the same RPC).
 *
 * Returns Map<lowerKey, { name: <most common exact spelling>, count: <row count> }>.
 * Tie-break on the most-common spelling: the FIRST spelling seen at the highest
 * count wins, so the result is deterministic run to run for the same input order.
 */
export function groupByCompanyName(rows) {
  const groups = new Map(); // lowerKey -> Map<spelling, count>
  for (const r of rows) {
    const raw = String(r?.company ?? "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const spellings = groups.get(key) ?? new Map();
    spellings.set(raw, (spellings.get(raw) ?? 0) + 1);
    groups.set(key, spellings);
  }
  const out = new Map();
  for (const [key, spellings] of groups) {
    let best = null;
    let total = 0;
    for (const [spelling, count] of spellings) {
      total += count;
      if (!best || count > best.count) best = { name: spelling, count };
    }
    out.set(key, { name: best.name, count: total });
  }
  return out;
}

/**
 * A slug already taken (by an existing row, or by another name earlier in THIS
 * run) gets a short numeric suffix so two distinctly-spelled names that squash
 * to the same slug never collide silently. Deterministic: first free
 * `${base}_2`, `${base}_3`, ...
 */
export function uniqueSlug(base, existingSlugs) {
  if (!base) return base;
  if (!existingSlugs.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!existingSlugs.has(candidate)) return candidate;
  }
}
