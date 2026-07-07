// Phase B (overnight-job-hunter, spec 2026-07-07 §7): pure logic for the nightly
// matches worker (api/nightly.ts). Zero runtime deps → unit-testable AND Node-safe
// (the Vercel worker imports these directly, no vite/@ alias). Pinned by
// src/test/nightly.test.ts. Rule + code move together.

/** How many top new matches to score + surface per user per night (spec §5). */
export const NIGHTLY_TOP_N = 10;

/** Look-back window when a user has no prior batch (first night): ~24h. */
export const NIGHTLY_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

export type NightlyJob = {
  id: string;
  company: string;
  title: string;
  url: string;
  location?: string | null;
  remote?: boolean;
  seniority?: string | null;
  jd_text?: string | null;
  sector?: string | null;
  first_seen_at?: string | null;
  posted_at?: string | null;
};

/** Best available "when did this job appear" timestamp in ms: first_seen_at →
 *  posted_at → 0 (unknown ⇒ treated as old, so it never counts as "new"). */
export function jobSeenMs(j: {
  first_seen_at?: string | null;
  posted_at?: string | null;
}): number {
  const t = j.first_seen_at ?? j.posted_at ?? null;
  if (!t) return 0;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Jobs that are NEW since the user's last nightly batch, newest first. `sinceIso`
 * is the last batch_date (or null on the first night → look back
 * NIGHTLY_FALLBACK_WINDOW_MS from nowMs). A job is new when its seen-time is
 * strictly after the cutoff. Pure — the worker's idempotency + "new since ~24h"
 * selection is testable here without a DB.
 */
export function selectNewJobsSince<
  T extends { first_seen_at?: string | null; posted_at?: string | null },
>(jobs: T[], sinceIso: string | null, nowMs: number, windowMs: number = NIGHTLY_FALLBACK_WINDOW_MS): T[] {
  const parsed = sinceIso ? Date.parse(sinceIso) : NaN;
  const cutoff = Number.isNaN(parsed) ? nowMs - windowMs : parsed;
  return jobs.filter((j) => jobSeenMs(j) > cutoff).sort((a, b) => jobSeenMs(b) - jobSeenMs(a));
}

export type ScoredMatch = {
  url: string;
  company: string;
  title: string;
  score: number;
  reason: string;
  fitBullets: string[];
};

export type RankedMatch = ScoredMatch & { rank: number };

/** Rank scored matches highest-first with a 1-based rank. Stable on ties (keeps
 *  input order). Pure. */
export function rankMatches(matches: ScoredMatch[]): RankedMatch[] {
  return matches
    .map((m, i) => ({ m, i }))
    .sort((a, b) => b.m.score - a.m.score || a.i - b.i)
    .map(({ m }, idx) => ({ ...m, rank: idx + 1 }));
}

/** Notification subject (spec §7 — a hook, not a digest). */
export function buildEmailSubject(count: number): string {
  return count === 1 ? "1 role matched to you today" : `${count} roles matched to you today`;
}

/** Escape the chars that matter inside an HTML text node / href attr. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The notification email body (spec §1/§7): a LIGHTWEIGHT hook, not a content
 * digest — the top few company/role names + a deep link back into the app. Files
 * never ride the email. Returns text + html. Pure.
 */
export function buildEmailBody(
  matches: RankedMatch[],
  appUrl: string,
  preview: number = 5,
): { text: string; html: string } {
  const top = matches.slice(0, preview);
  const more = matches.length - top.length;
  const plural = matches.length === 1 ? "" : "s";

  const text = [
    `You have ${matches.length} new role${plural} matched to you today.`,
    "",
    ...top.map((m) => `- ${m.company} — ${m.title}`),
    ...(more > 0 ? [`...and ${more} more.`] : []),
    "",
    `See them all: ${appUrl}`,
  ].join("\n");

  const html = [
    `<p>You have <strong>${matches.length}</strong> new role${plural} matched to you today.</p>`,
    `<ul>${top.map((m) => `<li>${esc(m.company)} — ${esc(m.title)}</li>`).join("")}</ul>`,
    ...(more > 0 ? [`<p>...and ${more} more.</p>`] : []),
    `<p><a href="${esc(appUrl)}">See them all</a></p>`,
  ].join("");

  return { text, html };
}
