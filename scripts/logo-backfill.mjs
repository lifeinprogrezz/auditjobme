#!/usr/bin/env node
/**
 * Logo-domain backfill (issue #68 item 4). Sweeps companies that have a live
 * role but a null logo_domain and derives the domain from the company's own
 * careers_url (falling back to website) via scripts/logo-lib.mjs — the Macadam
 * class (careers.macadam.app -> macadam.app). Hosted-ATS careers URLs
 * (teamtailor/greenhouse/...) never produce a domain: a wrong domain renders a
 * WRONG logo, so null stays null rather than guessing.
 *
 * Issue #153 item B1: a company with NEITHER a careers_url NOR a website (the
 * job-derived rows scripts/company-records.mjs creates have neither) falls
 * through to a second source — the apply URL of its own live job(s). The same
 * domainFromUrl() already excludes every hosted-ATS/platform host (Greenhouse,
 * Lever, LinkedIn, Notion...), so a resolved domain is the company's own site,
 * never a wrong-company guess; when it resolves, it fills BOTH website and
 * logo_domain in one write.
 *
 * Fix round 1 (this issue): the apply-URL fallback also caught job-board/
 * aggregator hosts not on the GENERIC_HOST_SUFFIXES list -- measured live on
 * prod, welcometothejungle.com alone resolved as 19 companies' "own" domain,
 * ycombinator.com 10. Those hosts are now on the list (logo-lib.mjs), plus a
 * second, data-driven guard here: any derived domain shared by >=3 distinct
 * companies in one run is an aggregator signature and is never written, even
 * for a host the static list doesn't yet name (partitionAggregatorDomains).
 *
 * Fix round 4 (this issue, the acceptance panel's logo-coverage defect): the two
 * sources above cover 638 of the 1,209 companies on the map (52.8%), short of the
 * issue's 90% target. The other 571 have no careers_url, no website, and an
 * apply URL on a hosted-ATS host, so both sources return null by design. Their
 * ATS apply URL does carry a clean company handle though
 * (jobs.ashbyhq.com/1password, adobe.wd5.myworkdayjobs.com), so a THIRD pass
 * turns that handle into candidate domains and PROBES each one on the network,
 * writing companies.logo_domain only when a real site answers on the candidate
 * itself. Handle parsing, candidate generation and response classification are
 * pure (scripts/logo-handle-lib.mjs, unit-tested offline); this file owns the
 * requests. Nothing is guessed in the browser: the client-side name guess was
 * removed on purpose in PR #164 (unsuppressable Chromium 404 console noise).
 *
 * SAFETY: dry-run is the DEFAULT — reports what it would set, writes nothing.
 * Pass --apply to write (the nightly workflow does; manual runs must opt in).
 * --dry-run is accepted as an explicit "never write", and wins over --apply.
 *
 * Usage:
 *   node scripts/logo-backfill.mjs            # dry-run (default)
 *   node scripts/logo-backfill.mjs --apply    # write derived logo domains
 *   node scripts/logo-backfill.mjs --apply --max-probes=1000   # bigger catch-up run
 */
import { createClient } from "@supabase/supabase-js";
import { resolveLogoDomain, partitionAggregatorDomains, domainFromUrl } from "./logo-lib.mjs";
import {
  handleFromApplyUrls,
  handleMatchesName,
  candidateDomains,
  siteProbeVerdict,
  iconProbeVerdict,
  isParkingBody,
  pageNamesCompany,
  bodyLinksAtsTenant,
  classifyFetchError,
  isProbeCacheFresh,
  isMissingProbeTableError,
  newHandleTally,
  handleSummaryLine,
} from "./logo-handle-lib.mjs";

const argValue = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
};
const DRY = process.argv.includes("--dry-run");
const APPLY = process.argv.includes("--apply") && !DRY;
// Bounded per run: the ATS-handle pass is the only part that touches third-party
// hosts, and --max-probes is the bound that matters -- it counts real requests,
// so a run stays inside a workflow's minutes. --max-companies is a safety valve
// above today's pool (571), not the working cap: capping companies instead would
// stall the sweep, because a company whose candidates all failed still sits in
// the alphabetical window and would block the ones behind it forever. Probes
// are cached, so each run spends its budget on ground the last one did not cover.
const MAX_COMPANIES = Number(argValue("max-companies", "1000")) || 1000;
const MAX_PROBES = Number(argValue("max-probes", "800")) || 800;
const PROBE_CONCURRENCY = 6;
const PROBE_TIMEOUT_MS = 8000;
const PROBE_USER_AGENT = "northgoing-logo-probe (hello@lifeinprogrezz.com)";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("logo-backfill: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — nothing to do.");
  process.exit(0);
}
const supabase = createClient(url, key);

// Companies with at least one live role (paged; the pool is a few thousand rows).
// Also collect a few apply URLs per company — the item B1 fallback source below.
const liveCompanyIds = new Set();
const urlsByCompany = new Map();
const URLS_PER_COMPANY = 5; // bounded: the first few live roles are enough to try
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from("jobs")
    .select("company_id, url")
    .eq("is_live", true)
    .not("company_id", "is", null)
    .range(from, from + 999);
  if (error) {
    console.error("logo-backfill: jobs select failed:", error.message);
    process.exit(1);
  }
  for (const r of data || []) {
    liveCompanyIds.add(r.company_id);
    const arr = urlsByCompany.get(r.company_id) ?? [];
    if (arr.length < URLS_PER_COMPANY) arr.push(r.url);
    urlsByCompany.set(r.company_id, arr);
  }
  if (!data || data.length < 1000) break;
}

// Paged (issue #153 fix round 3, blocker 2): scripts/company-records.mjs
// now grows this table well past PostgREST's 1000-row un-ranged cap within
// a few runs, and this null-logo_domain read is the load-bearing scan for
// every row it creates -- an un-paged read here would silently stop
// backfilling logos once `companies` crossed 1000 rows.
const companies = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from("companies")
    .select("slug, name, careers_url, website")
    .is("logo_domain", null)
    .range(from, from + 999);
  if (error) {
    console.error("logo-backfill: companies select failed:", error.message);
    process.exit(1);
  }
  companies.push(...(data || []));
  if (!data || data.length < 1000) break;
}

const candidates = (companies || []).filter((c) => liveCompanyIds.has(c.slug));
const fills = [];
let viaApplyUrl = 0;
for (const c of candidates) {
  const { domain, derivedWebsite } = resolveLogoDomain({
    careersUrl: c.careers_url,
    website: c.website,
    applyUrls: urlsByCompany.get(c.slug) ?? [],
  });
  if (derivedWebsite) viaApplyUrl++;
  if (domain) fills.push({ slug: c.slug, name: c.name, domain, website: derivedWebsite });
}

// Data-driven aggregator guard (issue #153 fix round 1, blocker 1): a domain
// shared by >=3 distinct companies in this run is an aggregator/ATS host
// that slipped past GENERIC_HOST_SUFFIXES, not a real company site.
const { safe: safeFills, skipped: skippedFills, aggregatorDomains } = partitionAggregatorDomains(fills);
const viaApplyUrlSafe = safeFills.filter((f) => f.website).length;

console.error(
  `logo-backfill: ${candidates.length} null-logo company(ies) with a live role; ${safeFills.length} derivable (${viaApplyUrlSafe} via apply-URL host)${APPLY ? "" : " (DRY RUN — pass --apply to write)"}`,
);
for (const f of safeFills) console.error(`  ${f.name} (${f.slug}) -> ${f.domain}${f.website ? " [+website]" : ""}`);
if (aggregatorDomains.size) {
  console.error(
    `logo-backfill: skipped ${skippedFills.length} company(ies) across ${aggregatorDomains.size} suspected aggregator domain(s) (>=3 companies sharing one derived domain, never written): ${[...aggregatorDomains].join(", ")}`,
  );
  for (const f of skippedFills) console.error(`  SKIPPED ${f.name} (${f.slug}) -> ${f.domain}`);
}

// ── Pass 3 (fix round 4): ATS-handle candidates, validated before any write ──
// Only companies the two URL-derived sources could not resolve AND that name no
// site of their own at all. A company WITH a website on file is left to the
// existing sources: its domain is a fact, not a guess.
const resolvedSlugs = new Set(safeFills.map((f) => f.slug));
const handleTargets = candidates
  .filter((c) => !resolvedSlugs.has(c.slug) && !c.website && !c.careers_url)
  .sort((a, b) => String(a.slug).localeCompare(String(b.slug))) // reproducible day to day
  .slice(0, MAX_COMPANIES);

const tally = newHandleTally();
const plans = [];
for (const c of handleTargets) {
  const hit = handleFromApplyUrls(urlsByCompany.get(c.slug) ?? []);
  if (!hit) {
    tally.noHandle++;
    continue;
  }
  if (!handleMatchesName(hit.handle, c.name)) {
    tally.nameMismatch++;
    continue;
  }
  // domainFromUrl is the one place that knows every hosted-ATS/platform host,
  // so a candidate it refuses (join.com from the "join" handle, gem.com...) is
  // dropped here rather than duplicating that list.
  const domains = candidateDomains(hit.handle, hit.ats).filter((d) => domainFromUrl(`https://${d}`) === d);
  if (!domains.length) {
    tally.noCandidate++;
    continue;
  }
  tally.companies++;
  plans.push({ slug: c.slug, name: c.name, ats: hit.ats, handle: hit.handle, domains });
}

// ── the probe cache (migration 20260827160000). Absent table = no caching. ──
let cacheDisabled = false;
function warnCacheDisabled(where) {
  if (cacheDisabled) return;
  cacheDisabled = true;
  console.error(
    `logo-backfill: logo_probe_cache table not found at ${where} — caching disabled for the rest of this run (apply migration 20260827160000_logo_probe_cache.sql to enable it).`,
  );
}

const cache = new Map();
async function loadProbeCache(domains) {
  const list = [...new Set(domains)];
  for (let i = 0; i < list.length && !cacheDisabled; i += 300) {
    const { data, error } = await supabase
      .from("logo_probe_cache")
      .select("domain, ok, probed_at")
      .in("domain", list.slice(i, i + 300));
    if (error) {
      if (isMissingProbeTableError(error)) warnCacheDisabled("read");
      else {
        cacheDisabled = true;
        console.error(`logo-backfill: probe-cache read failed (${error.message}) — caching disabled for this run.`);
      }
      return;
    }
    for (const row of data || []) cache.set(row.domain, row);
  }
}
await loadProbeCache(plans.flatMap((p) => p.domains));

const cacheWrites = [];
let probesUsed = 0;

/** One ranged GET of the candidate's own root. One request, and its body is
 *  what tells a real site apart from a for-sale lander served on the same host,
 *  and from a live site that belongs to somebody with a similar name. */
async function probeSite(domain, name) {
  let res;
  try {
    res = await fetch(`https://${domain}/`, {
      headers: { Range: "bytes=0-4095", "User-Agent": PROBE_USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (e) {
    return { verdict: classifyFetchError(e), status: 0 };
  }
  const status = res.status === 206 ? 200 : res.status;
  const verdict = siteProbeVerdict({ status, finalUrl: res.url, candidate: domain });
  if (verdict !== "ok") {
    try {
      await res.body?.cancel();
    } catch {
      /* body already consumed or never started */
    }
    return { verdict, status: res.status };
  }
  let body = "";
  try {
    body = await res.text();
  } catch {
    body = "";
  }
  if (isParkingBody(body)) return { verdict: "parked", status: res.status };
  if (!pageNamesCompany(body, name)) return { verdict: "other-brand", status: res.status };
  return { verdict: "ok", status: res.status, body };
}

/** The tie-break request: a company's careers page is where it links the board
 *  its job came from. Full page, not a range: the link is usually far down. */
async function fetchCareersPage(domain) {
  try {
    const res = await fetch(`https://${domain}/careers`, {
      headers: { "User-Agent": PROBE_USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {
        /* nothing to release */
      }
      return "";
    }
    return await res.text();
  } catch {
    return "";
  }
}

/** Second chance for a site that refuses a plain read but still serves its
 *  icon. Only a 200 with real image bytes counts. */
async function probeIcon(domain) {
  try {
    const res = await fetch(`https://${domain}/favicon.ico`, {
      headers: { Range: "bytes=0-0", "User-Agent": PROBE_USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    try {
      await res.body?.cancel();
    } catch {
      /* nothing to release */
    }
    const verdict = iconProbeVerdict({
      status: res.status === 206 ? 200 : res.status,
      contentType: res.headers.get("content-type"),
      contentLength: res.headers.get("content-length"),
    });
    return { verdict, status: res.status };
  } catch {
    return { verdict: "reject", status: 0 };
  }
}

/** No answer either way from this candidate -- see classifyFetchError. */
const UNKNOWN = Symbol("unreachable");

/** Validate ONE candidate: cache first, then the network within budget.
 *  Returns { body } when the domain answers as the company, false when it does
 *  not, UNKNOWN when the request got no answer, and null when there was no
 *  probe budget left to ask. */
async function validate(domain, name) {
  const cached = cache.get(domain);
  if (isProbeCacheFresh(cached)) {
    tally.cacheHits++;
    // A remembered pass carries no page with it, so a tie-break on this
    // candidate reads its careers page instead of a body it already had.
    return cached.ok === true ? { body: "" } : false;
  }
  if (probesUsed >= MAX_PROBES) return null; // out of budget: leave it for the next run
  probesUsed++;
  tally.candidatesTried++;
  let { verdict, status, body } = await probeSite(domain, name);
  // "parked", "offsite" and "other-brand" are answers, not silence: a site that
  // says it belongs to somebody else is never re-asked through its favicon.
  if (verdict === "dead") ({ verdict, status } = await probeIcon(domain));
  if (verdict === "unreachable") {
    // No answer either way. Not remembered, so the next run asks again.
    tally.unreachable++;
    return UNKNOWN;
  }
  const ok = verdict === "ok";
  if (ok) tally.validated++;
  else tally.rejected++;
  if (verdict === "other-brand") tally.otherBrand++;
  cacheWrites.push({ domain, ok, status: status || null, reason: verdict });
  return ok ? { body: body || "" } : false;
}

const handleFills = [];

/**
 * Every candidate for one company is probed, and the domain is written ONLY
 * when exactly one of them answers as that company. Measured live on
 * 2026-08-27 over a 14-company sample of a first-hit-wins run, 3 were wrong
 * (Granola -> granola.com, a food site, while the company is granola.ai;
 * Faculty -> faculty.com, a product studio, while the company is faculty.ai;
 * Axelera -> axelera.com, an IT firm, while the company is axelera.ai). In all
 * three the .ai answered as the company too, so two live sites carried the
 * name and the first one tried won by luck. When two answer, one tie-break
 * decides it: the company's own site links the board its job came from, so
 * granola.ai/careers points at ashbyhq.com/granola and the food site points at
 * nothing. No winner there writes nothing, because a wrong logo is another
 * company's mark on the map while a missing one is a coloured initial.
 *
 * A plan that runs out of probe budget part-way is dropped for this run rather
 * than judged on the candidates it did reach, because a single hit out of a
 * half-checked list is not evidence that it was the only one.
 */
async function runPlan(plan) {
  const hits = [];
  for (const domain of plan.domains) {
    const hit = await validate(domain, plan.name);
    if (hit === null) {
      tally.budgetExhausted++;
      return;
    }
    if (hit && hit !== UNKNOWN) hits.push({ domain, body: hit.body });
  }
  const keep = (domain) =>
    handleFills.push({ slug: plan.slug, name: plan.name, domain, handle: plan.handle, ats: plan.ats });
  const ownsBoard = (h) => bodyLinksAtsTenant(`${h.body}${h.careers ?? ""}`, plan.ats, plan.handle);

  if (hits.length === 0) return;
  if (hits.length === 1) return keep(hits[0].domain);

  // Two live sites carry the name. Whichever one hires through the board this
  // company's job came from is the company (bodyLinksAtsTenant). The first pass
  // is free: it re-reads the page bodies already fetched.
  let owners = hits.filter(ownsBoard);
  if (owners.length !== 1) {
    for (const h of hits) {
      if (probesUsed >= MAX_PROBES) break;
      probesUsed++;
      tally.tieBreakFetches++;
      h.careers = await fetchCareersPage(h.domain);
    }
    owners = hits.filter(ownsBoard);
  }
  if (owners.length === 1) {
    tally.tieBroken++;
    return keep(owners[0].domain);
  }
  tally.ambiguous++;
  console.error(
    `  AMBIGUOUS ${plan.name} (${plan.slug}) -> ${hits.map((h) => h.domain).join(", ")} — nothing written`,
  );
}

// Small worker pool: a handful of hosts at a time, never a burst at one of them
// (every candidate is a different host, so this is polite by construction).
let nextPlan = 0;
await Promise.all(
  Array.from({ length: Math.min(PROBE_CONCURRENCY, plans.length) }, async () => {
    while (nextPlan < plans.length) await runPlan(plans[nextPlan++]);
  }),
);

// Same aggregator guard as pass 2: one real company owns one domain, so a
// domain claimed by three companies in one run is somebody's platform.
const {
  safe: safeHandleFills,
  skipped: skippedHandleFills,
  aggregatorDomains: handleAggregators,
} = partitionAggregatorDomains(handleFills);
for (const f of safeHandleFills) console.error(`  ${f.name} (${f.slug}) -> ${f.domain} [via ${f.ats} handle ${f.handle}]`);
if (handleAggregators.size) {
  console.error(
    `logo-backfill(handle): skipped ${skippedHandleFills.length} company(ies) across ${handleAggregators.size} suspected shared domain(s): ${[...handleAggregators].join(", ")}`,
  );
}

if (!APPLY) {
  console.error(handleSummaryLine(tally, { apply: false }));
  console.error("logo-backfill: DRY RUN — no writes.");
  process.exit(0);
}

let written = 0;
for (const f of safeFills) {
  const update = { logo_domain: f.domain };
  if (f.website) update.website = f.website;
  const { error: e } = await supabase.from("companies").update(update).eq("slug", f.slug);
  if (e) console.error(`logo-backfill: update failed for ${f.slug}: ${e.message}`);
  else written++;
}
console.error(`logo-backfill: wrote ${written} logo domain(s).`);

// A handle-derived domain fills logo_domain ONLY. It is validated, but it is
// still derived, and `website` is read by the company-enrichment pass as a fact
// about the company — leaving it null keeps that pass free to find the real one.
for (const f of safeHandleFills) {
  const { error: e } = await supabase.from("companies").update({ logo_domain: f.domain }).eq("slug", f.slug);
  if (e) console.error(`logo-backfill: handle update failed for ${f.slug}: ${e.message}`);
  else tally.written++;
}
for (let i = 0; i < cacheWrites.length && !cacheDisabled; i += 300) {
  const { error: e } = await supabase
    .from("logo_probe_cache")
    .upsert(cacheWrites.slice(i, i + 300).map((w) => ({ ...w, probed_at: new Date().toISOString() })), {
      onConflict: "domain",
    });
  if (e) {
    if (isMissingProbeTableError(e)) warnCacheDisabled("write");
    else console.error(`logo-backfill: probe-cache write failed: ${e.message}`);
  }
}
console.error(handleSummaryLine(tally, { apply: true }));
