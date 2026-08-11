/**
 * Pure liveness-verdict logic for the nightly sweep (scripts/liveness-sweep.mjs),
 * ported from the personal career-ops engine's liveness-pre-render.mjs (issue #68).
 * Pinned by src/test/liveness-lib.test.ts — change verdicts only with a test update.
 *
 * Conservative dead-criteria — ONLY these ever retire a row:
 *   - HTTP 404 or 410 explicit
 *   - redirect that lands on a generic jobs-index path (the posting slug dropped)
 * Anti-bot 403 / 5xx / timeouts / connection errors are "unverified" and are
 * NEVER auto-killed: a blocked check is not a dead posting.
 *
 * LinkedIn URLs are never fetched at all (repo rule: no LinkedIn scraping) and
 * never auto-killed: unauthenticated hits bounce to /authwall, which would look
 * exactly like a slug-dropping redirect and false-kill a live posting.
 */

// Source classes retired by the scrape's own board-diff (they vanish from a feed
// we re-scan daily). Everything else — vc:*, startupmap, workday, factorial,
// bigtech, seed — has NO retirement path except the liveness sweep.
// Single source of truth: scripts/scrape.mjs imports this list.
export const BOARD_KINDS = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "teamtailor"];

const NEVER_FETCH_HOST_RE = /(^|\.)linkedin\.com$/i;

/** True when the URL is one the sweep must not fetch (LinkedIn authwall class). */
export function isUncheckableUrl(url) {
  try {
    return NEVER_FETCH_HOST_RE.test(new URL(url).hostname);
  } catch {
    return true; // unparseable URL: can't check it, never kill it
  }
}

/** A redirect that dropped the posting slug and landed on a generic jobs index. */
export function isDeadRedirect(finalUrl, originalUrl) {
  try {
    const orig = new URL(originalUrl);
    const fin = new URL(finalUrl);
    if (orig.host !== fin.host) return false; // cross-host redirect — too ambiguous
    if (fin.pathname === orig.pathname) return false; // same path — not a slug drop
    // Final path is a generic listings page
    if (/^\/(jobs|careers|positions|opportunities|openings)\/?$/i.test(fin.pathname)) return true;
    // Final path is drastically shorter — probable slug drop
    if (fin.pathname.length < orig.pathname.length * 0.4 && fin.pathname.length < 20) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Pure verdict from an observed response. `finalUrl` is the post-redirect URL
 * (fetch follows redirects, so a slug-dropping 30x shows up as ok + moved URL).
 * Returns { verdict: "dead"|"live"|"unverified", reason }.
 */
export function classifyLiveness({ url, status, ok, finalUrl }) {
  if (isUncheckableUrl(url)) return { verdict: "unverified", reason: "linkedin-not-checkable" };
  if (status === 404 || status === 410) return { verdict: "dead", reason: `http-${status}` };
  if (status >= 300 && status < 400 && finalUrl && isDeadRedirect(finalUrl, url)) {
    return { verdict: "dead", reason: "redirect-drops-slug" };
  }
  if (ok && finalUrl && isDeadRedirect(finalUrl, url)) {
    return { verdict: "dead", reason: "silent-redirect-drops-slug" };
  }
  if (status === 403) return { verdict: "unverified", reason: "http-403-likely-antibot" };
  if (status === 429) return { verdict: "unverified", reason: "http-429-rate-limited" };
  if (status >= 500) return { verdict: "unverified", reason: `http-${status}-transient` };
  if (ok) return { verdict: "live", reason: `http-${status}` };
  return { verdict: "unverified", reason: `http-${status}` };
}

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * HEAD-check one URL (GET fallback on 405/501) and classify. `fetchImpl` is
 * injectable for tests; never fetches LinkedIn hosts at all.
 */
export async function checkUrl(url, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (isUncheckableUrl(url)) return { verdict: "unverified", reason: "linkedin-not-checkable" };
  // jsdom's AbortSignal (vitest environment) has no .timeout — degrade to no signal there.
  const makeSignal = () => (typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined);
  const opts = (method) => ({
    method,
    redirect: "follow",
    signal: makeSignal(),
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
  });
  try {
    let r = await fetchImpl(url, opts("HEAD"));
    if (r.status === 405 || r.status === 501) r = await fetchImpl(url, opts("GET"));
    return classifyLiveness({ url, status: r.status, ok: r.ok, finalUrl: r.url });
  } catch (e) {
    const timedOut = e && (e.name === "AbortError" || e.name === "TimeoutError");
    return { verdict: "unverified", reason: timedOut ? "timeout" : "fetch-error" };
  }
}
