/**
 * Getro VC-board row integrity (issue #68 item 2). The vc:getro:* boards
 * (Entrepreneur First / Atomico / Cherry) emit LinkedIn URLs instead of
 * ATS-direct ones, and some rows carry the WRONG company attribution
 * (verified live: Beekeeper rows -> LumApps postings, Passfort -> Moody's).
 *
 * Recorded decision (issue thread, per the ATS-direct-URL priority rule):
 *   canonicalize LinkedIn -> ATS where resolvable
 *   -> else re-attribute to the real company from the URL slug
 *   -> else drop the row.
 *
 * "Resolvable" here means the feed itself handed us an ATS-direct URL (kept
 * as-is): resolving a LinkedIn posting to its ATS twin would require scraping
 * LinkedIn, which this repo forbids (CLAUDE.md rule 5). So for LinkedIn URLs:
 * the slug (`<title>-at-<company>-<id>`) names the REAL company; when it
 * disagrees with the board's claimed organization we re-attribute, when no
 * company is recoverable from the URL we drop.
 *
 * Pure logic, no network. Pinned by src/test/getro-lib.test.ts.
 */

const LINKEDIN_HOST_RE = /(^|\.)linkedin\.com$/i;

/**
 * Parse a LinkedIn job URL. Returns null for non-LinkedIn URLs; for LinkedIn
 * job URLs returns { id, companySlug } (either may be null when absent).
 * Recognized shapes:
 *   /jobs/view/4123456789
 *   /jobs/view/senior-product-manager-at-lumapps-4123456789
 */
export function parseLinkedInJobUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!LINKEDIN_HOST_RE.test(u.hostname)) return null;
  const m = u.pathname.match(/\/jobs\/view\/([^/]+?)\/?$/i);
  if (!m) return { id: null, companySlug: null };
  const seg = decodeURIComponent(m[1]);
  const idMatch = seg.match(/(\d{6,})$/);
  // Greedy prefix pins the LAST "-at-": a title like "pm-at-scale-at-acme-4123456789"
  // must yield "acme", not "scale-at-acme".
  const atMatch = seg.match(/^.*-at-(.+?)-\d{6,}$/i);
  return {
    id: idMatch ? idMatch[1] : null,
    companySlug: atMatch ? atMatch[1] : null,
  };
}

/** "lumapps" -> "Lumapps", "moody-s" -> "Moody S" (best-effort display name). */
export function companyFromSlug(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Loose company-identity comparison: "Moody's" ≈ slug "moody-s". */
export function sameCompany(a, b) {
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  const na = norm(a);
  const nb = norm(b);
  return na.length > 0 && na === nb;
}

/**
 * Resolve one Getro row. Returns one of:
 *   { action: "keep", job }          — ATS-direct URL, or LinkedIn URL whose slug
 *                                      confirms the claimed company (URL canonicalized)
 *   { action: "reattribute", job }   — LinkedIn slug names a different company;
 *                                      job.company corrected, URL canonicalized
 *   { action: "drop", reason }       — LinkedIn URL with no recoverable company
 */
export function resolveGetroJob(job) {
  const li = parseLinkedInJobUrl(job.url);
  if (!li) return { action: "keep", job }; // ATS-direct (or non-LinkedIn) — canonical already
  if (!li.companySlug) return { action: "drop", reason: "linkedin-url-no-company-slug" };

  // Canonical LinkedIn form: numeric id when present (dedups slug variants),
  // else the original path stripped of query/hash tracking.
  const canonUrl = li.id
    ? `https://www.linkedin.com/jobs/view/${li.id}`
    : job.url.split("?")[0].split("#")[0];

  if (sameCompany(companyFromSlug(li.companySlug), job.company)) {
    return { action: "keep", job: { ...job, url: canonUrl } };
  }
  return {
    action: "reattribute",
    job: { ...job, company: companyFromSlug(li.companySlug), url: canonUrl },
  };
}

/**
 * Resolve a batch of Getro rows. Returns { jobs, kept, reattributed, dropped }
 * where `jobs` contains only keep + reattribute results.
 */
export function resolveGetroJobs(rows) {
  const out = { jobs: [], kept: 0, reattributed: 0, dropped: 0 };
  for (const row of rows || []) {
    const r = resolveGetroJob(row);
    if (r.action === "drop") {
      out.dropped++;
    } else if (r.action === "reattribute") {
      out.reattributed++;
      out.jobs.push(r.job);
    } else {
      out.kept++;
      out.jobs.push(r.job);
    }
  }
  return out;
}
