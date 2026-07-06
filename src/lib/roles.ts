// Shared contracts for the /roles globe page (issue #14).
// Design authority: .claude/skills/glass-design/SKILL.md + the v43 mockup.

export type RoleJob = {
  id: string;
  company: string;
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
  /** Normalized city (geo.ts), null = unknown → shown in panel, not on map. */
  city: string | null;
  /** Jittered map coords, null when city is unknown. */
  lngLat: [number, number] | null;
  /** Company domain for Logo.dev, null → colored-initial fallback. */
  domain: string | null;
};

export type ScoreBucket = "great" | "mid" | "low";

/** Scores are 0–5 (NOT the mockup's 0–10): great ≥4.0 · mid ≥3.0 · low <3.0. */
export function scoreBucket(score: number): ScoreBucket {
  return score >= 4 ? "great" : score >= 3 ? "mid" : "low";
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
export const LEVELS: { value: Level; label: string }[] = [
  { value: "apm", label: "Associate PM" },
  { value: "pm", label: "Product Manager" },
  { value: "senior", label: "Senior PM" },
  { value: "lead", label: "Lead / Group PM" },
  { value: "founding", label: "Founding PM" },
];

export type RolesFilters = {
  query: string;
  levels: Level[];
  remoteOnly: boolean;
};

export const EMPTY_FILTERS: RolesFilters = { query: "", levels: [], remoteOnly: false };

/** Client-side filter, honest to the data (query over company/title/city/location). */
export function filterJobs(jobs: RoleJob[], f: RolesFilters): RoleJob[] {
  const q = f.query.trim().toLowerCase();
  return jobs.filter((j) => {
    if (f.remoteOnly && !j.remote) return false;
    if (f.levels.length && !f.levels.includes((j.seniority ?? "") as Level)) return false;
    if (!q) return true;
    return [j.company, j.title, j.city ?? "", j.location ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(q);
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
  landed: ReadonlyMap<string, { score: number; reason: string | null }>,
  sort: boolean,
): RoleJob[] {
  const next = prev.map((x) => {
    const hit = landed.get(x.id);
    return hit ? { ...x, score: hit.score, reason: hit.reason } : x;
  });
  return sort ? next.sort(byScore) : next;
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
