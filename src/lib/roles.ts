// Shared contracts for the /roles globe page (issue #14).
// Design authority: .claude/skills/glass-design/SKILL.md + the v43 mockup.

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
  posted_at: string | null;
  /** Per-user fit score 0–5 (score.ts rubric), null = not scored yet. */
  score: number | null;
  /** One-sentence "why it fits" from scores.signals.reason. */
  reason: string | null;
  /** 3-5 grounded "why you fit" bullets (scores.signals.fit_bullets, v2 rubric). */
  fitBullets?: string[] | null;
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
  /** JD-extracted structured facts (jobs.extraction); null when not extracted yet. */
  extraction?: RoleExtraction | null;
};

export type ScoreBucket = "great" | "mid" | "low";

/** Scores are 0–5 (NOT the mockup's 0–10): great ≥4.0 · mid ≥3.0 · low <3.0. */
export function scoreBucket(score: number): ScoreBucket {
  return score >= 4 ? "great" : score >= 3 ? "mid" : "low";
}

/** Short, honest qualitative label for the score hero in the /roles detail panel. */
export function fitLabel(score: number): string {
  const b = scoreBucket(score);
  return b === "great" ? "Strong fit" : b === "mid" ? "Solid fit" : "Weak fit";
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
  // Non-English languages the user reads. POSITIVE facet (Rober 7-09): selecting
  // German surfaces English-only roles PLUS German-required ones; a role with no
  // language wall is never excluded. Optional so filter fixtures that omit it
  // still typecheck.
  languages?: string[];
  remoteOnly: boolean;
};

export const EMPTY_FILTERS: RolesFilters = {
  query: "",
  levels: [],
  cities: [],
  sectors: [],
  sizes: [],
  languages: [],
  remoteOnly: false,
};

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

export function filterJobs(jobs: RoleJob[], f: RolesFilters): RoleJob[] {
  const q = f.query.trim().toLowerCase();
  return jobs.filter((j) => {
    if (f.remoteOnly && !j.remote) return false;
    if (f.levels.length && !f.levels.includes((j.seniority ?? "") as Level)) return false;
    if (f.cities.length && !(j.city != null && f.cities.includes(j.city))) return false;
    if (f.sectors.length && !(j.sector != null && f.sectors.includes(j.sector))) return false;
    if (f.sizes.length) {
      const band = sizeBand(j.headcount);
      if (!band || !f.sizes.includes(band)) return false;
    }
    // Positive Language facet: a role passes if it needs no extra language (English
    // implicit → never hidden) OR the user reads EVERY language it requires.
    if (f.languages && f.languages.length) {
      const sel = f.languages;
      const req = requiredLanguages(j);
      if (req.length && !req.every((l) => sel.includes(l))) return false;
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
  landed: ReadonlyMap<string, { score: number; reason: string | null; fitBullets?: string[] | null }>,
  sort: boolean,
): RoleJob[] {
  const next = prev.map((x) => {
    const hit = landed.get(x.id);
    return hit
      ? { ...x, score: hit.score, reason: hit.reason, fitBullets: hit.fitBullets ?? x.fitBullets }
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
