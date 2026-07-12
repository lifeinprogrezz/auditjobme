// Phase B (overnight-job-hunter, spec 2026-07-07 §7): pure logic for the nightly
// matches worker (api/nightly.ts). Zero runtime deps → unit-testable AND Node-safe
// (the Vercel worker imports these directly, no vite/@ alias). Pinned by
// src/test/nightly.test.ts. Rule + code move together.

/** How many top new matches to score + surface per user per night (spec §5). */
export const NIGHTLY_TOP_N = 10;

/** Look-back window when a user has no prior batch (first night): ~24h. */
export const NIGHTLY_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Cron-caller authorization check (pure). Returns the error response to send, or
 * `null` when the caller is authorized. The endpoint fails CLOSED: a MISSING
 * CRON_SECRET is a misconfiguration (500), NOT a bypass — so the worker can never
 * be publicly triggerable. When the secret is set, only `Bearer <secret>` passes.
 * Vercel Cron invokes over GET with this exact header; the HTTP method is not part
 * of the auth decision.
 */
export function cronAuthResult(
  cronSecret: string | undefined | null,
  authHeader: string | string[] | undefined | null,
): { status: number; error: string } | null {
  if (!cronSecret) return { status: 500, error: "CRON_SECRET not configured" };
  if (authHeader !== `Bearer ${cronSecret}`) return { status: 401, error: "Unauthorized" };
  return null;
}

export type NightlyJob = {
  id: string;
  company: string;
  title: string;
  url: string;
  location?: string | null;
  remote?: boolean;
  seniority?: string | null;
  jd_text?: string | null;
  yoe_min?: number | null;
  geo_eligibility?: string | null;
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

/**
 * The full "what to score tonight" decision (pure): jobs new since the cutoff
 * (`selectNewJobsSince`) MINUS any URL the user has already been matched on in a
 * prior batch. `sinceIso` MUST be the prior batch's `created_at` (a real
 * timestamptz), NOT its `batch_date` (a bare date parsed as 00:00 UTC) — the cron
 * runs at 06:00 UTC, so a batch_date cutoff would re-select every job first seen in
 * the 00:00–06:00 window as "new" the next night. The `seenUrls` set is the
 * belt-and-suspenders guard: even a cutoff regression (or a schedule change) can
 * never re-notify a role the user has already seen. First-run behaviour (null
 * `sinceIso` → the ~24h fallback window) is inherited from `selectNewJobsSince`.
 */
export function selectNightlyCandidates<
  T extends { url: string; first_seen_at?: string | null; posted_at?: string | null },
>(
  jobs: T[],
  sinceIso: string | null,
  nowMs: number,
  seenUrls: ReadonlySet<string> = new Set(),
  windowMs: number = NIGHTLY_FALLBACK_WINDOW_MS,
): T[] {
  return selectNewJobsSince(jobs, sinceIso, nowMs, windowMs).filter((j) => !seenUrls.has(j.url));
}

/** What to do for one user this run (pure). Splits "already matched today" from
 *  "already notified today", and (F7) treats a batch scored under a SUPERSEDED
 *  rubric as stale:
 *   - no batch today             → "score"       (run the full scoring pass)
 *   - batch today at OLD rubric  → "rescore"     (re-score today's window under the
 *                                                 current rubric — F7 parity with the
 *                                                 in-app + backlog paths, which filter
 *                                                 cached scores by rubric_version)
 *   - batch today, not notified  → "retry-email" (email failed soft before → resend
 *                                                 the existing batch; do NOT re-score)
 *   - batch today, notified      → "skip"        (fully done for the day)
 *  `notified_at` (written only on send-success) is what gates the same-day early
 *  exit, so a soft email failure never strands a user without their one email. A
 *  null/absent `rubric_version` (pre-migration rows) reads as stale → rescored once. */
export type NightlyAction = "score" | "rescore" | "retry-email" | "skip";
export function decideNightlyAction(
  todaysRows: { notified_at?: string | null; rubric_version?: string | null }[],
  currentRubric: string,
): NightlyAction {
  if (todaysRows.length === 0) return "score";
  if (todaysRows.some((r) => (r.rubric_version ?? null) !== currentRubric)) return "rescore";
  return todaysRows.some((r) => r.notified_at != null) ? "skip" : "retry-email";
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

/** Notification subject — transactional/notification tone (biases Gmail's Updates
 *  tab; a marketing-style "matched to you today" reads as Promotions). `dateLabel`
 *  e.g. "Jul 7". Spec §7 — a hook, not a digest. */
export function buildEmailSubject(count: number, dateLabel?: string): string {
  const noun = count === 1 ? "match" : "matches";
  const suffix = dateLabel ? ` (${dateLabel})` : "";
  return `Your job ${noun} — ${count} new${suffix}`;
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
