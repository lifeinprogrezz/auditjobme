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

/** Score-desc, nulls last, stable for equal scores (company then title). */
export function byScore(a: RoleJob, b: RoleJob): number {
  if (a.score == null && b.score == null)
    return a.company.localeCompare(b.company) || a.title.localeCompare(b.title);
  if (a.score == null) return 1;
  if (b.score == null) return -1;
  return b.score - a.score || a.company.localeCompare(b.company);
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
