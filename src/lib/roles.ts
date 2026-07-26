// Shared contracts for the /roles globe page (issue #14).
// Design authority: .claude/skills/glass-design/SKILL.md + the v43 mockup.

import type { ScoreSubscore, ScoreEvidence } from "@/lib/scorePrompt";
// ONE source for "when did this role appear" (first_seen_at → posted_at → unknown).
// nightly.ts is dependency-free, so the browser bundle and the Node nightly worker
// share the exact same fallback instead of drifting apart. Issue #73 slice 3.
import { jobSeenMs } from "@/lib/nightly";

/** Role-level structured facts extracted from the JD (jobs.extraction JSONB,
 *  written by scripts/extract-jd.mjs). Every field nullable; null = unknown →
 *  the role stays eligible/shown (fail-open). */
export type RoleExtraction = {
  yoe_min?: number | null;
  languages_required?: string[] | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_period?: string | null;
  visa_sponsorship?: "offered" | "not_offered" | null;
  geo_eligibility?: string | null;
  is_product_role?: boolean | null;
  remote_policy?: "onsite" | "hybrid" | "remote" | null;
  onsite_days_per_week?: number | null;
  customer_type?: string | null;
  company_stage?: string | null;
};

export type RoleJob = {
  id: string;
  company: string;
  /** companies.slug this role belongs to (drives the curated "hot companies" view). */
  company_id?: string | null;
  title: string;
  url: string;
  location: string | null;
  remote: boolean;
  source: string | null;
  seniority: string | null;
  /** Role vertical (jobs.role_family). Null = pre-all-vertical row → roleFamily()
   *  maps it to "Product Manager" while the pipeline is PM-gated (issue #34). */
  role_family?: string | null;
  /** Workplace mode (jobs.workplace, scrape-owned): remote | hybrid | onsite.
   *  Null = unknown → workplaceOf() falls back to extraction.remote_policy, then
   *  the remote flag. Drives the headbar Workplace facet. */
  workplace?: string | null;
  posted_at: string | null;
  /** When the scrape first saw this role (jobs.first_seen_at, NOT NULL in the DB).
   *  Optional here only because a pre-#73 dataplane artifact predates the column;
   *  roleSeenMs falls back to posted_at, so freshness degrades instead of breaking. */
  first_seen_at?: string | null;
  /** Per-user fit score 0–5 (score.ts rubric), null = not scored yet. */
  score: number | null;
  /** One-sentence "why it fits" from scores.signals.reason. */
  reason: string | null;
  /** 3-5 grounded "why you fit" bullets (scores.signals.fit_bullets, v2 rubric). */
  fitBullets?: string[] | null;
  /** Per-dimension rubric subscores (scores.signals.subscores, v4) — the score
   *  breakdown bars in the detail panel. Null/empty = pre-v4 or unscored. */
  subscores?: ScoreSubscore[] | null;
  /** Cited cv_line↔jd_phrase evidence rows (scores.signals.evidence, v4), grounded
   *  before persistence. Null/empty = pre-v4 or unscored. */
  evidence?: ScoreEvidence[] | null;
  /** Normalized city (geo.ts), null = unknown → shown in panel, not on map. */
  city: string | null;
  /** Jittered map coords, null when city is unknown. */
  lngLat: [number, number] | null;
  /** Company domain for Logo.dev, null → colored-initial fallback. */
  domain: string | null;
  // Company context (from the companies dimension; null/absent when unknown).
  // Surfaced in the /roles detail panel — RolesPanel.renderDetail, Rober 2026-07-06.
  website?: string | null;
  sector?: string | null;
  stage?: string | null; // raw enum e.g. "series_b" → formatStage() for display
  headcount?: string | null; // bucket e.g. "51-200" → formatHeadcount() for display
  hqCity?: string | null;
  hqCountry?: string | null;
  linkedin?: string | null;
  description?: string | null;
  foundedYear?: number | null;
  /** companies.uk_sponsor_status from the Home Office register match (Phase B slice 4):
   *  'licensed' = holds a Skilled-Worker sponsor licence · 'unmatched' = absent from the
   *  register · null = unchecked/uncertain. A COMPANY attribute — shown in the company-info
   *  row (with stage/size/founded), distinct from the role-level JD visa-sponsorship fact. */
  ukSponsorStatus?: string | null;
  /** JD-extracted structured facts (jobs.extraction); null when not extracted yet. */
  extraction?: RoleExtraction | null;
};

export type ScoreBucket = "great" | "mid" | "low";

/** Scores are 0–5 (NOT the mockup's 0–10): great ≥4.0 · mid ≥3.0 · low <3.0. */
export function scoreBucket(score: number): ScoreBucket {
  return score >= 4 ? "great" : score >= 3 ? "mid" : "low";
}

/** Fit hero label — the locked copy matrix (design direction §3.5), driven by the
 *  bucket: great "Strong fit" · mid "Fair fit" · low "Weak fit". */
export function fitLabel(score: number): string {
  const b = scoreBucket(score);
  return b === "great" ? "Strong fit" : b === "mid" ? "Fair fit" : "Weak fit";
}

/** Geo / work-authorization verdict for a role (issue #42, finishing the RolesPanel
 *  partial). SAFETY PROPERTY: never show a WRONG verdict — only surface a positive or
 *  barrier when the JD states it unambiguously; when nothing is stated, fall through to
 *  'unverified' (the honest "not stated" state) rather than guess. This guards the
 *  login-walled / sidebar-salary traps memory flags. Pure; pinned by geo-verdict.test.ts. */
export type GeoVerdictKind = "sponsors" | "eu-eligible" | "barrier" | "unverified";
export interface GeoVerdict {
  kind: GeoVerdictKind;
  /** Short, abbreviation-expanded label for a badge / data cell. */
  label: string;
  /** Surface as a prominent card badge? Only high-confidence, actionable verdicts. */
  onCard: boolean;
}
// A US-only / US-work-authorization requirement is a clear barrier for an EU-based
// job seeker. Deliberately narrow: only unambiguous "US only" phrasings, so an
// incidental "US" mention (e.g. "US, Europe, APAC") never fabricates a barrier.
const GEO_US_ONLY_RE =
  /\b(u\.?s\.?[- ]?only|us[- ]?based only|must (?:be|reside)[^.]{0,30}(?:united states|u\.?s\.?a?\b)|authoriz(?:ed|ation) to work in the (?:us|united states)|green ?card|us citizen(?:ship)?)/i;
// EU / EEA / Europe-wide eligibility stated in the JD — a positive for the EU target.
const GEO_EU_RE = /\b(eu|eea|european union|emea|europe|europe-?wide)\b/i;

export function geoVerdict(job: RoleJob): GeoVerdict {
  const ex = job.extraction ?? null;
  // 1. Role explicitly offers to sponsor a visa — the strongest positive.
  if (ex?.visa_sponsorship === "offered") return { kind: "sponsors", label: "Sponsors visa", onCard: true };
  const geo = (ex?.geo_eligibility ?? "").trim();
  // 2. Stated US-only barrier — never soften a barrier the JD spells out.
  if (geo && GEO_US_ONLY_RE.test(geo)) return { kind: "barrier", label: "US work authorization", onCard: true };
  // 3. Stated EU / EEA / Europe eligibility. NOT a card badge (Rober 7-25: the
  // "EU eligible" bubble read as noise on an EU-focused catalog — every role is
  // implicitly Europe-relevant here). Still surfaced in the detail pane's
  // Work-eligibility row, where the stated-vs-not distinction earns its place.
  if (geo && GEO_EU_RE.test(geo)) return { kind: "eu-eligible", label: "EU eligible", onCard: false };
  // 4. Nothing trustworthy in the JD → the honest "not stated" state (never a guess).
  return { kind: "unverified", label: "Work eligibility not stated", onCard: false };
}

/** Cluster bubble tier — startupmap-matched count breaks (<15 / ≥15 / ≥50 / ≥150).
 *  Light glass below 50, ink above (their light→dark hub split); z-index ladder
 *  so bigger hubs win marker overlaps. No sublabel: the "roles" word under the
 *  count pushed the number off the bubble's center (Rober 7-05). */
export type ClusterTier = {
  size: number;
  fontSize: number;
  /** Light glass bubble (small counts); false = ink hub. */
  light: boolean;
  zIndex: number;
};
export function clusterTier(count: number): ClusterTier {
  if (count >= 150) return { size: 76, fontSize: 17, light: false, zIndex: 24 };
  if (count >= 50) return { size: 64, fontSize: 15, light: false, zIndex: 22 };
  if (count >= 15) return { size: 54, fontSize: 14, light: true, zIndex: 20 };
  return { size: 44, fontSize: 13.5, light: true, zIndex: 20 };
}

/** Deterministic accent hue per company for logo-initial fallbacks (mockup HUE). */
const HUE = ["#1FD8B8", "#9E8CFF", "#FFC44D", "#FF6F4D", "#3CB4FF", "#EC6FE0", "#5EE08A"];
export function hueFor(company: string): string {
  let h = 0;
  for (let i = 0; i < company.length; i++) h = (h * 31 + company.charCodeAt(i)) | 0;
  return HUE[Math.abs(h) % HUE.length];
}

export type Level = "apm" | "pm" | "senior" | "lead" | "founding";
// Normalized seniority ladder (Rober 7-06): title-agnostic tiers, shared by the
// headbar Level filter AND the detail-panel Level cell so the two never disagree.
// "Executive" is the top bucket (Founding/Head/Director-level PM roles).
export const LEVELS: { value: Level; label: string }[] = [
  { value: "apm", label: "Junior" },
  { value: "pm", label: "Mid" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead" },
  { value: "founding", label: "Executive" },
];

export type RolesFilters = {
  query: string;
  levels: Level[];
  // City + sector are opt-in multi-selects (Rober 7-06). Only dimensions with
  // near-complete coverage are filterable: every role has a resolvable city, and
  // ~80% of companies carry a sector — so an empty selection always shows the full
  // catalog and no company silently disappears from the default view. Sparse fields
  // (founded year, funding round) are deliberately NOT filters for that reason.
  cities: string[];
  sectors: string[];
  sizes: string[]; // canonical size bands (sizeBand); ~84% company coverage
  // Non-English languages a role requires. DISCOVERY facet (Rober 7-09): selecting
  // German narrows the view to ONLY roles that wall on German (map + panel); an
  // English-only role is hidden while a language is selected. Optional so filter
  // fixtures that omit it still typecheck.
  languages?: string[];
  // Role vertical (roleFamily). Optional like languages so filter fixtures typecheck.
  roles?: string[];
  // Workplace modes (workplaceOf). DISCOVERY facet like languages: selecting a mode
  // shows only roles KNOWN to match; unknown rows hide while a selection is active
  // (~60% of the catalog is honestly unlabeled — "unknown matches everything" would
  // fill a Hybrid view with unlabeled roles). Optional so fixtures typecheck.
  workplaces?: string[];
  // Age windows in days as strings ("7" | "14" | "28"), keyed on roleSeenMs. A
  // multi-select reads as a UNION, so picking 7 and 28 means "within 28 days" —
  // the widest selected window wins (freshnessCutoffMs). Issue #73 slice 3.
  freshness?: string[];
  // companies.uk_sponsor_status values ("licensed" | "unmatched"). DISCOVERY facet:
  // a company we never checked (null) hides while a selection is active, because a
  // silent register match is not evidence of a licence. Issue #73 slice 5.
  sponsors?: string[];
};

export const EMPTY_FILTERS: RolesFilters = {
  query: "",
  levels: [],
  cities: [],
  sectors: [],
  sizes: [],
  languages: [],
  roles: [],
  workplaces: [],
  freshness: [],
  sponsors: [],
};

/** Fixed option order + display labels for the Freshness facet (issue #73 slice 3).
 *  Deliberately a FILTER only: we measured freshness against 10,921 rows of the
 *  personal engine's scoring data on 2026-07-26 and it does NOT predict match
 *  quality (the learned weights are non-monotonic), so an age tilt in the queue
 *  ranking would rank on noise. Filtering by recency is a user preference; ranking
 *  by it would be a fabricated signal. */
export const FRESHNESS_WINDOWS: { value: string; label: string; days: number }[] = [
  { value: "7", label: "7 days", days: 7 },
  { value: "14", label: "14 days", days: 14 },
  { value: "28", label: "28 days", days: 28 },
];

/** Fixed option order + expanded labels for the UK sponsor-licence facet. The status
 *  is a COMPANY attribute from the Home Office register (already rendered as a badge
 *  in the detail panel); this makes it filterable for UK-target users. */
export const UK_SPONSOR_STATUSES: { value: string; label: string }[] = [
  { value: "licensed", label: "Licensed UK sponsor" },
  { value: "unmatched", label: "Not on the UK register" },
];

/** When this role appeared, in epoch ms: first_seen_at → posted_at → 0 (unknown).
 *  Shared with the nightly worker's selection so the app and the email agree on
 *  what "new" means. */
export function roleSeenMs(job: Pick<RoleJob, "first_seen_at" | "posted_at">): number {
  return jobSeenMs(job);
}

/** Oldest seen-time that still passes the selected freshness windows, or null when
 *  nothing is selected (no age filter). The WIDEST selected window wins — a
 *  multi-select is a union, so 7 + 28 means "within 28 days". */
export function freshnessCutoffMs(selected: string[] | undefined, nowMs: number): number | null {
  if (!selected || selected.length === 0) return null;
  const days = selected
    .map((v) => FRESHNESS_WINDOWS.find((w) => w.value === v)?.days)
    .filter((d): d is number => d != null);
  if (days.length === 0) return null;
  return nowMs - Math.max(...days) * 86_400_000;
}

/** Client-side filter, honest to the data. Free-text query matches company + title
 *  ONLY (geography is the City filter's job now — the headbar no longer claims to
 *  search cities). City/sector/size are OR-within, AND-across: a role passes if its
 *  city is among the selected cities AND its sector is among the selected sectors AND
 *  its size band is selected (each ignored when its selection is empty). A role
 *  missing the field can't match a chosen value. */
/** Non-English languages a role EXPLICITLY requires (English is implicit, so it's
 *  filtered out). Drives the positive Language facet + the detail badge. Empty when
 *  the role has no extra-language wall → it always passes the filter. */
export function requiredLanguages(job: RoleJob): string[] {
  const langs = job.extraction?.languages_required;
  if (!Array.isArray(langs)) return [];
  return langs.filter(
    (l): l is string => typeof l === "string" && l.trim() !== "" && l.trim().toLowerCase() !== "english",
  );
}

/** Role vertical for the Role facet. Null = pre-all-vertical row (the pipeline is
 *  PM-gated), mapped to "Product Manager" — the single null→PM source shared by the
 *  filter clause and the facet counter so they never disagree. Real values win the
 *  moment the engine writes them (issue #34). */
export function roleFamily(job: RoleJob): string {
  return job.role_family ?? "Product Manager";
}

/** Fixed option order + display labels for the Workplace facet. */
export const WORKPLACES: { value: string; label: string }[] = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
];

/** Workplace mode for the Workplace facet: the scrape-owned jobs.workplace wins,
 *  then the JD-extracted remote_policy, then the legacy remote flag. Null = unknown
 *  (shown by default, hidden only while a Workplace selection is active). */
export function workplaceOf(job: RoleJob): string | null {
  return job.workplace ?? job.extraction?.remote_policy ?? (job.remote ? "remote" : null);
}

export function filterJobs(jobs: RoleJob[], f: RolesFilters, nowMs: number = Date.now()): RoleJob[] {
  const q = f.query.trim().toLowerCase();
  const freshCutoff = freshnessCutoffMs(f.freshness, nowMs);
  return jobs.filter((j) => {
    // Freshness = a DISCOVERY filter: a role whose seen-time we don't hold (both
    // first_seen_at and posted_at missing) can't be proven fresh, so it hides while
    // a window is selected rather than being fabricated into it.
    if (freshCutoff != null && roleSeenMs(j) < freshCutoff) return false;
    // UK sponsor licence — same discovery semantics: an unchecked company (null) is
    // not evidence of a licence, so it hides while a status is selected.
    if (f.sponsors && f.sponsors.length) {
      if (!j.ukSponsorStatus || !f.sponsors.includes(j.ukSponsorStatus)) return false;
    }
    // Workplace = a DISCOVERY filter (like languages): only roles KNOWN to match a
    // selected mode pass; unknown-mode rows hide while a selection is active.
    if (f.workplaces && f.workplaces.length) {
      const w = workplaceOf(j);
      if (!w || !f.workplaces.includes(w)) return false;
    }
    if (f.levels.length && !f.levels.includes((j.seniority ?? "") as Level)) return false;
    if (f.roles && f.roles.length && !f.roles.includes(roleFamily(j))) return false;
    if (f.cities.length && !(j.city != null && f.cities.includes(j.city))) return false;
    if (f.sectors.length && !(j.sector != null && f.sectors.includes(j.sector))) return false;
    if (f.sizes.length) {
      const band = sizeBand(j.headcount);
      if (!band || !f.sizes.includes(band)) return false;
    }
    // Language facet = a DISCOVERY filter (Rober 7-09): selecting German narrows the
    // map + panel to ONLY the roles that wall on German. An English-only role has no
    // wall, so it's hidden while any language is selected; multi-select is a union
    // (German OR French → roles requiring either).
    if (f.languages && f.languages.length) {
      const sel = f.languages;
      const req = requiredLanguages(j);
      if (!req.some((l) => sel.includes(l))) return false;
    }
    if (!q) return true;
    return [j.company, j.title].join(" ").toLowerCase().includes(q);
  });
}

/** A company's roles in one city (case-insensitive company match). A null `city`
 *  matches all of that company's roles regardless of city — mirrors the map pin,
 *  which is keyed per company-in-a-city but carries a null city for unknowns.
 *  Drives the /roles pin click: exactly one role → open its detail, else list. */
export function companyCityRoles(
  jobs: RoleJob[],
  company: string,
  city: string | null,
): RoleJob[] {
  const co = company.trim().toLowerCase();
  return jobs.filter(
    (j) => j.company.trim().toLowerCase() === co && (city == null || j.city === city),
  );
}

/** Score-desc, nulls last, stable for equal scores (company then title). */
export function byScore(a: RoleJob, b: RoleJob): number {
  if (a.score == null && b.score == null)
    return a.company.localeCompare(b.company) || a.title.localeCompare(b.title);
  if (a.score == null) return 1;
  if (b.score == null) return -1;
  return b.score - a.score || a.company.localeCompare(b.company);
}

/** Apply a batch of landed scores to the jobs array (#26). Row order is kept
 * STABLE unless `sort`: a mid-pass re-sort remaps supercluster ids wholesale
 * (full marker churn on the globe per landed score) — the display sort belongs
 * at the end of the scoring pass, once. */
export function applyLandedScores(
  prev: RoleJob[],
  landed: ReadonlyMap<
    string,
    {
      score: number;
      reason: string | null;
      fitBullets?: string[] | null;
      subscores?: ScoreSubscore[] | null;
      evidence?: ScoreEvidence[] | null;
    }
  >,
  sort: boolean,
): RoleJob[] {
  const next = prev.map((x) => {
    const hit = landed.get(x.id);
    return hit
      ? {
          ...x,
          score: hit.score,
          reason: hit.reason,
          fitBullets: hit.fitBullets ?? x.fitBullets,
          subscores: hit.subscores ?? x.subscores,
          evidence: hit.evidence ?? x.evidence,
        }
      : x;
  });
  return sort ? next.sort(byScore) : next;
}

const STAGE_LABELS: Record<string, string> = {
  pre_seed: "Pre-seed", seed: "Seed", series_a: "Series A", series_b: "Series B",
  series_c: "Series C", series_d: "Series D", series_e: "Series E", series_f: "Series F",
  growth: "Growth", late_stage: "Late stage", public: "Public", acquired: "Acquired",
  bootstrapped: "Bootstrapped", ipo: "IPO",
};
/** Funding stage for display: known enum → label, else title-cased fallback. null passes through. */
export function formatStage(stage: string | null | undefined): string | null {
  if (!stage) return null;
  const key = stage.trim().toLowerCase();
  return STAGE_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Headcount bucket for display: "51-200" → "51–200" (en dash, "people" implied). null passes through. */
export function formatHeadcount(bucket: string | null | undefined): string | null {
  if (!bucket) return null;
  const b = bucket.trim();
  return b ? b.replace(/\s*-\s*/g, "–") : null;
}

// Raw headcount buckets arrive in two inconsistent source schemes (LinkedIn-style
// 1-10/11-50/51-200/201-500/500-2k/2k+ AND a scraped <10/10-30/30-100/100-500/500+).
// Normalize both into ONE canonical, non-overlapping size ladder (mapped by midpoint)
// so the Size filter offers clean, distinct options instead of overlapping buckets.
// Rober 7-06; pinned by size-band.test.ts.
const SIZE_BANDS = ["1–10", "11–50", "51–200", "201–500", "500–2k", "2k+"] as const;
const RAW_TO_BAND: Record<string, number> = {
  "<10": 0, "1-10": 0,
  "10-30": 1, "11-50": 1,
  "30-100": 2, "51-200": 2,
  "100-500": 3, "201-500": 3,
  "500+": 4, "500-2k": 4,
  "2k+": 5,
};
/** Canonical size band for a raw headcount bucket; null when unknown/unmapped. */
export function sizeBand(bucket: string | null | undefined): string | null {
  if (!bucket) return null;
  const i = RAW_TO_BAND[bucket.trim()];
  return i == null ? null : SIZE_BANDS[i];
}
/** Sort order for a canonical size band (small→large); 99 for unknown. */
export function sizeBandOrder(band: string): number {
  const i = (SIZE_BANDS as readonly string[]).indexOf(band);
  return i < 0 ? 99 : i;
}

/** Best website URL for a company: an explicit website wins, else derive it from the
 *  logo domain (99% coverage) so the panel almost always has a live link. null if neither. */
export function websiteUrl(
  website: string | null | undefined,
  domain: string | null | undefined,
): string | null {
  if (website && website.trim()) return website.trim();
  if (domain && domain.trim()) return `https://${domain.trim()}`;
  return null;
}

/** "3d ago"-style label from posted_at; null when unknown (never fabricate). */
export function postedAgo(postedAt: string | null, now = Date.now()): string | null {
  if (!postedAt) return null;
  const t = Date.parse(postedAt);
  if (Number.isNaN(t) || t > now) return null;
  const days = Math.floor((now - t) / 86_400_000);
  if (days === 0) return "today";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}
