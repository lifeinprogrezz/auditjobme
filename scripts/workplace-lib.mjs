// Pure workplace-mode classification (remote | hybrid | onsite) for jobs.workplace.
// SCRAPE-OWNED signal chain: structured ATS field ?? location string ?? JD text —
// resolved by resolveWorkplace() in every scrape pass, so the nightly upsert keeps
// the column fresh. extract-jd owns the separate extraction.remote_policy; the
// client falls back workplace -> remote_policy -> remote flag (src/lib/roles.ts).
// Unit tests: workplace-lib.test.mjs (node --test, offline).
// Spec: planning repo docs/specs/2026-07-10-headbar-role-facet-design.md (addendum).

/** Canonicalize an ATS-provided workplace value (Lever workplaceType: "on-site" |
 *  "remote" | "hybrid" | "unspecified"; others vary). Unknown/absent → null. */
export function normWorkplace(v) {
  const t = String(v ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (t === "remote") return "remote";
  if (t === "hybrid") return "hybrid";
  if (t === "onsite") return "onsite";
  return null;
}

/** Location strings often state the mode outright ("Berlin (Hybrid)", "Remote - EMEA").
 *  Precedence hybrid > onsite > remote: a location mentioning hybrid alongside remote
 *  ("Remote (Hybrid optional)") means the role is not fully remote. */
export function workplaceFromLocation(location) {
  const t = String(location ?? "");
  if (!t) return null;
  if (/\bhybrid\b/i.test(t)) return "hybrid";
  if (/\bon[\s-]?site\b|\boffice[\s-]based\b/i.test(t)) return "onsite";
  if (/\bremote\b/i.test(t)) return "remote";
  return null;
}

/** JD-text classification from UNAMBIGUOUS phrasing only (a bare "remote" mention can
 *  be negated — "no remote work" — so it never counts). Hybrid checked first: JDs that
 *  say "N days in the office" often also say "remote" for the other days. */
export function workplaceFromJd(jdText) {
  const t = String(jdText ?? "");
  if (!t) return null;
  if (
    /\bhybrid\b|\b\d+\s*days?\s*(?:a|per)\s*week\s*(?:in|at)\s*(?:the\s+|our\s+)?\S*\s*office\b|\b\d+\s*days?\s*(?:in[\s-]?)?(?:the\s+)?office\b|\b\d+\s*days?\s*(?:on[\s-]?site|onsite)\b/i.test(t)
  )
    return "hybrid";
  if (/\bon[\s-]?site\s+(?:role|position)\b|\boffice[\s-]based\b|\bin[\s-]office\b|\bon[\s-]?site only\b/i.test(t))
    return "onsite";
  if (/\bfully[\s-]remote\b|\bremote[\s-]first\b|\b100%\s*remote\b|\bwork\s+from\s+anywhere\b/i.test(t))
    return "remote";
  return null;
}

/** The write-time chain: structured ATS field ?? location ?? JD. Every input optional. */
export function resolveWorkplace({ structured, location, jdText } = {}) {
  return normWorkplace(structured) ?? workplaceFromLocation(location) ?? workplaceFromJd(jdText);
}
