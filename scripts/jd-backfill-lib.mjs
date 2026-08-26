// JD backfill — the pure half (issue #143, follow-up to #130). No network, no DB.
// scripts/jd-backfill.mjs owns the fetches and the writes; everything that can be
// unit-tested offline lives here: which ATS a URL belongs to, how to pull the
// posting id out of it, how to turn each ATS's detail payload into plain text,
// and which sources may follow their apply URL to find an ATS behind it.
// Unit tests: jd-backfill-lib.test.mjs (node --test, offline).
import { stripHtml } from "./job-filters.mjs";

/** Rows attempted per run. Newest-first, so a role scraped this morning gets its
 *  JD today and scores on the next backlog tick; the older tail catches up over
 *  the following runs. ~2,000 blank live rows ÷ 300 = the gap closes in a week. */
export const BACKFILL_LIMIT = 300;

export const JD_CAP = 8000;

/** Trim + cap a stripped JD; empty → null so callers never persist "". */
export function cap(s) {
  const t = (s || "").slice(0, JD_CAP);
  return t || null;
}

/** The scorer's readability rule (src/lib/scorePrefilter.ts hasReadableJd): a
 *  description is only worth writing when it has non-blank text. */
export function isReadableJd(s) {
  return typeof s === "string" && s.trim().length > 0;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Which ATS route serves this URL, by host. Null = no deterministic endpoint we
 *  trust; the row is reported as unsupported, never scraped as generic HTML. */
export function atsKindOf(url) {
  const host = hostOf(url);
  if (!host) return null;
  if (/(^|\.)greenhouse\.io$/.test(host)) return "greenhouse";
  if (/(^|\.)lever\.co$/.test(host)) return "lever";
  if (/(^|\.)ashbyhq\.com$/.test(host)) return "ashby";
  if (/(^|\.)smartrecruiters\.com$/.test(host)) return "smartrecruiters";
  if (/(^|\.)workable\.com$/.test(host)) return "workable";
  if (/(^|\.)recruitee\.com$/.test(host)) return "recruitee";
  if (/(^|\.)personio\.(de|com)$/.test(host)) return "personio";
  if (/(^|\.)join\.com$/.test(host)) return "join";
  if (/(^|\.)teamtailor\.com$/.test(host)) return "teamtailor";
  if (/\.(myworkdayjobs|myworkdaysite)\.com$/.test(host)) return "workday";
  return null;
}

/** Sources whose apply URL is a board link that redirects to the employer's ATS
 *  (startupmap, scaling-europe, the vc:* getro boards). Only these may follow the
 *  URL once; the final host is then routed through atsKindOf like any other row. */
export const FOLLOW_SOURCE_RE = /^(startupmap|scaling-europe|vc:)/;

export function shouldFollow(source) {
  return FOLLOW_SOURCE_RE.test(source || "");
}

// ── URL → posting reference ──────────────────────────────────────────────────

/** greenhouse: boards|job-boards.greenhouse.io/{token}/jobs/{id}, or the
 *  embedded /embed/job_app?for={token}&token={id}. */
export function greenhouseRef(url) {
  const m = url.match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
  if (m) return { token: m[1], id: m[2] };
  try {
    const u = new URL(url);
    const token = u.searchParams.get("for");
    const id = u.searchParams.get("token");
    return token && id ? { token, id } : null;
  } catch {
    return null;
  }
}

/** lever: jobs.lever.co/{token}/{id} */
export function leverRef(url) {
  const m = url.match(/lever\.co\/([^/?#]+)\/([^/?#]+)/);
  return m ? { token: m[1], id: m[2] } : null;
}

/** ashby: jobs.ashbyhq.com/{token}/{id} */
export function ashbyRef(url) {
  const m = url.match(/ashbyhq\.com\/([^/?#]+)\/([^/?#]+)/);
  return m ? { token: m[1], id: m[2] } : null;
}

/** smartrecruiters: jobs|careers.smartrecruiters.com/{company}/{id}[-slug] */
export function smartRecruitersRef(url) {
  try {
    const segs = new URL(url).pathname.split("/").filter(Boolean);
    if (segs.length < 2) return null;
    const uuid = segs[1].match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    const id = uuid ? uuid[0] : (segs[1].match(/^\d+/) || [])[0];
    return id ? { company: segs[0], id } : null;
  } catch {
    return null;
  }
}

/** recruitee: {company}.recruitee.com/o/{slug} */
export function recruiteeRef(url) {
  try {
    const u = new URL(url);
    const company = u.hostname.split(".")[0];
    const m = u.pathname.match(/\/o\/([^/?#]+)/);
    return company && m ? { company, slug: m[1] } : null;
  } catch {
    return null;
  }
}

/** personio: {company}.jobs.personio.{de|com}/job/{id} → the feed lives at {origin}/xml */
export function personioRef(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/job\/(\d+)/);
    return m ? { origin: u.origin, id: m[1] } : null;
  } catch {
    return null;
  }
}

// ── Detail payload → plain text (each returns a capped string or null) ───────

/** greenhouse: GET boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}?content=true */
export function extractGreenhouse(json) {
  return cap(stripHtml(json && json.content));
}

/** lever: GET api.lever.co/v0/postings/{token}/{id}?mode=json */
export function extractLever(json) {
  if (!json) return null;
  return cap(json.descriptionPlain || stripHtml(json.description));
}

/** ashby: GET api.ashbyhq.com/posting-api/job-board/{token} → the posting whose id matches */
export function extractAshby(json, id) {
  const posting = ((json && json.jobs) || []).find(
    (p) => p.id === id || (p.jobUrl && p.jobUrl.includes(id)) || (p.applyUrl && p.applyUrl.includes(id)),
  );
  if (!posting) return null;
  return cap(stripHtml(posting.descriptionHtml || posting.descriptionPlain));
}

/** smartrecruiters: GET api.smartrecruiters.com/v1/companies/{company}/postings/{id}
 *  → every jobAd.sections.*.text, in order (jobDescription, qualifications, ...) */
export function extractSmartRecruiters(json) {
  const sections = ((json && json.jobAd) || {}).sections || {};
  const parts = [];
  for (const k of Object.keys(sections)) {
    const t = sections[k] && sections[k].text;
    if (t) parts.push(t);
  }
  return cap(stripHtml(parts.join("\n")));
}

/** recruitee: GET {company}.recruitee.com/api/offers/ → the offer whose slug matches */
export function extractRecruitee(json, slug) {
  const offer = ((json && json.offers) || []).find((o) => o.slug === slug || slug.startsWith(o.slug));
  return offer ? cap(stripHtml(offer.description)) : null;
}

/** personio: GET {origin}/xml → the <position> whose <id> matches → <jobDescriptions> */
export function extractPersonio(xml, id) {
  for (const p of (xml || "").matchAll(/<position>([\s\S]*?)<\/position>/gi)) {
    const block = p[1];
    const idm = block.match(/<id>\s*(\d+)\s*<\/id>/i);
    if (!idm || idm[1] !== id) continue;
    const dm = block.match(/<jobDescriptions>([\s\S]*?)<\/jobDescriptions>/i);
    if (!dm) return null;
    return cap(stripHtml(dm[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "")));
  }
  return null;
}

/** A JobPosting.description from a page's JSON-LD blocks (join / teamtailor /
 *  workday / workable). Handles a bare object, an array, and an @graph wrapper. */
export function jsonLdDescription(html) {
  const blocks = [
    ...(html || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const b of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(b[1].trim());
    } catch {
      continue;
    }
    const nodes = [];
    const push = (x) => {
      if (x && typeof x === "object") nodes.push(x);
    };
    if (Array.isArray(parsed)) parsed.forEach(push);
    else {
      push(parsed);
      if (Array.isArray(parsed["@graph"])) parsed["@graph"].forEach(push);
    }
    for (const n of nodes) {
      const t = n["@type"];
      const isJob = t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
      if (isJob && n.description) return n.description;
    }
  }
  return null;
}

/** JSON-LD JobPosting.description from an ATS-hosted page, else null. */
export function extractJsonLd(html) {
  const desc = jsonLdDescription(html);
  return desc ? cap(stripHtml(desc)) : null;
}

/** workable: the apply page is a client-rendered SPA and the public detail API is
 *  gated, so the reliable signal is a JSON-LD JobPosting when present, else the
 *  og:description summary paragraph (partial, but far better than title-only). */
export function extractWorkable(html) {
  const ld = extractJsonLd(html);
  if (ld) return ld;
  const og = ((html || "").match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)/i) || [])[1];
  if (!og) return null;
  const decoded = og
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return cap(stripHtml(decoded));
}

/** Run counters. One object, one shape, so the summary line never drifts. */
export function newTally() {
  return { selected: 0, attempted: 0, filled: 0, failed: 0, unsupported: 0, followed: 0 };
}

export function summaryLine(t, { dry, wrote }) {
  return (
    `jd-backfill: selected ${t.selected} · attempted ${t.attempted} · filled ${t.filled}` +
    ` · failed ${t.failed} · unsupported ${t.unsupported} · followed ${t.followed}` +
    (dry ? " · [dry-run] no writes" : ` · wrote ${wrote}`)
  );
}
