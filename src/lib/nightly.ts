// Phase B (overnight-job-hunter, spec 2026-07-07 §7): pure logic for the nightly
// matches worker (api/nightly.ts). Zero runtime deps → unit-testable AND Node-safe
// (the Vercel worker imports these directly, no vite/@ alias; the one local import
// below is pure too, and carries the .js extension Node ESM requires). Pinned by
// src/test/nightly.test.ts. Rule + code move together.
import { companyKey, warmMarkerLabel } from "./connections.js";
import { BRAND_NAME } from "./brandName.js";

/** How many top new matches to score + surface per user per night (spec §5). */
export const NIGHTLY_TOP_N = 10;

/** Look-back window when a user has no prior batch (first night): ~24h. */
export const NIGHTLY_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * F6 durable execution: wall-clock budget for ONE nightly invocation's user loop.
 * A many-user night can't fit in a single 60s function (vercel.json maxDuration),
 * so the outer loop STOPS starting new users once the budget is spent and the
 * repeat trigger (.github/workflows/nightly.yml, every 10 min in the morning drain
 * window) resumes on the next tick. Kept comfortably under 60s so the in-flight
 * user finishes + the response flushes. Resumption is idempotent for free:
 * `decideNightlyAction` returns "skip"/"retry-email" for users already done today,
 * so the next tick picks up exactly where this one left off. Matches the
 * score-backlog worker's RUN_BUDGET_MS.
 */
export const NIGHTLY_RUN_BUDGET_MS = 45_000;

/** True once the invocation has spent its time budget and must stop the outer user
 *  loop (the next repeat-trigger tick resumes). Pure — testable without a clock. */
export function nightlyBudgetExhausted(
  startedMs: number,
  nowMs: number,
  budgetMs: number = NIGHTLY_RUN_BUDGET_MS,
): boolean {
  return nowMs - startedMs >= budgetMs;
}

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
  /** jobs.role_family (#34): selects the per-family scoring fit block. */
  role_family?: string | null;
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

/** True when a PostgREST error means daily_matches.rubric_version doesn't exist —
 *  i.e. migration 20260712123000_daily_matches_rubric_version hasn't been applied.
 *  The nightly handler degrades gracefully on it (re-select/re-upsert without the
 *  stamp) instead of losing the day's batch: PGRST204 = unknown column on write,
 *  42703 = undefined column on read. Pure. */
export function isMissingRubricColumn(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  const msg = err.message ?? "";
  if (!msg.includes("rubric_version")) return false;
  return err.code === "PGRST204" || err.code === "42703" || /column/i.test(msg);
}

/**
 * #54: classify the daily_matches HISTORY read that seeds `seenUrls` (the
 * exactly-once guard). The nightly worker MUST know every URL the user has already
 * been matched on; a read that fails but yields `data = null` would empty that set
 * and re-notify roles the user has already seen. Three outcomes:
 *   - "ok"       → no error, use the rows.
 *   - "fallback" → the rubric_version column is missing (pre-F7 schema); retry the
 *                  read without that column (isMissingRubricColumn).
 *   - "skip"     → ANY other read error. The caller skips the user (loud warn)
 *                  rather than proceeding on empty history and re-notifying.
 * Pure. A residual error AFTER the fallback attempt is handled by the caller's own
 * null-check, so this only drives the FIRST decision. */
export type HistoryReadDecision = "ok" | "fallback" | "skip";
export function classifyHistoryRead(
  err: { code?: string | null; message?: string | null } | null | undefined,
): HistoryReadDecision {
  if (!err) return "ok";
  if (isMissingRubricColumn(err)) return "fallback";
  return "skip";
}

export type ScoredMatch = {
  url: string;
  company: string;
  title: string;
  score: number;
  reason: string;
  fitBullets: string[];
  /** Where the role is, for the email's company/location line (issue #72 slice 3).
   *  Optional: an unknown location is simply omitted, never guessed. */
  location?: string | null;
  /** How many of the user's own connections work at this company (issue #108,
   *  following #41/#104). Information for the email row ONLY — deliberately no
   *  score or rank input, same rule as the web cards. Absent/0 renders nothing. */
  warmCount?: number;
};

export type RankedMatch = ScoredMatch & { rank: number };

/**
 * Warm-contacts marker for the email rows (issue #108, follow-up to #41 / PR #104).
 * `connectionKeys` are the STORED company_key values from the user's own
 * `connections` rows; each match's company is normalized through the SAME
 * companyKey() the web cards use, so the email and the Today card can never
 * disagree on who counts as warm. Returns new match objects carrying `warmCount`
 * where > 0; with no keys (user never uploaded a connections export) it returns
 * the input array UNCHANGED — the exact no-op the no-connections path needs.
 * Deliberately never touches score or rank. Pure.
 */
export function attachWarmCounts(
  matches: RankedMatch[],
  connectionKeys: readonly string[],
): RankedMatch[] {
  if (connectionKeys.length === 0) return matches;
  const counts = new Map<string, number>();
  for (const k of connectionKeys) {
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return matches.map((m) => {
    const n = counts.get(companyKey(m.company)) ?? 0;
    return n > 0 ? { ...m, warmCount: n } : m;
  });
}

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
 *  e.g. "Jul 7". Spec §7 — a hook, not a digest. No em-dash: BRAND.md's copy rule
 *  covers email, and the subject line is the most-read copy we ship. */
export function buildEmailSubject(count: number, dateLabel?: string): string {
  const noun = count === 1 ? "match" : "matches";
  const suffix = dateLabel ? ` (${dateLabel})` : "";
  return `Your job ${noun}, ${count} new${suffix}`;
}

/** Escape the chars that matter inside an HTML text node / href attr. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Deep link to ONE role's apply page (issue #72 slice 3). The email used to carry a
 *  single "See them all" link, so every role cost a hunt through the app; each row
 *  now lands on its own /apply page. Mirrors the in-app route exactly:
 *  /apply?job=<encoded posting url>. */
export function applyUrl(appUrl: string, jobUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/apply?job=${encodeURIComponent(jobUrl)}`;
}

/** Score as the email shows it: one decimal out of five, never a raw float. */
function scoreLabel(score: number): string {
  return `${score.toFixed(1)} out of 5`;
}

/** "Barcelona" / "Remote" style suffix for the meta line; empty when unknown. */
function metaLine(m: RankedMatch): string {
  const loc = m.location?.trim();
  return loc ? `${scoreLabel(m.score)} · ${loc}` : scoreLabel(m.score);
}

// Brand ink + muted, straight from BRAND.md's light palette. Inlined because email
// clients drop <style> blocks; a system font stack because they drop webfonts too.
const INK = "#0b1f26";
const MUTED = "#3f5a63";
const HAIR = "rgba(11,31,38,0.12)";
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * The notification email body (spec §1/§7, upgraded in issue #72 slice 3). Still a
 * NOTIFICATION, not a marketing digest: a plain brand wordmark, one line of context,
 * then the top few roles, each carrying its score, a one-line reason, its company and
 * location, and a deep link to ITS OWN /apply page. The transactional tone is load
 * bearing (with the List-Unsubscribe header in api/nightly.ts it is what keeps this
 * out of Promotions), so no images, no buttons, no campaign voice. Files never ride
 * the email. Returns text + html. Pure.
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
    BRAND_NAME,
    "",
    `You have ${matches.length} new role${plural} matched to you today.`,
    "",
    ...top.flatMap((m) => {
      // Warm marker (issue #108): same copy as the Today card, information only —
      // the rank and score around it are untouched by it, deliberately.
      const warm = warmMarkerLabel(m.warmCount ?? 0);
      return [
        `${m.company}`,
        `${m.title}`,
        metaLine(m),
        ...(warm ? [warm] : []),
        ...(m.reason?.trim() ? [m.reason.trim()] : []),
        `Prepare your application: ${applyUrl(appUrl, m.url)}`,
        "",
      ];
    }),
    ...(more > 0 ? [`...and ${more} more.`, ""] : []),
    `See them all: ${appUrl}`,
  ].join("\n");

  const rows = top
    .map((m) => {
      const warm = warmMarkerLabel(m.warmCount ?? 0);
      return [
        `<div style="padding:14px 0;border-top:1px solid ${HAIR}">`,
        `<div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:${MUTED}">${esc(m.company)}</div>`,
        `<div style="margin-top:2px"><a href="${esc(applyUrl(appUrl, m.url))}" style="font-size:16px;font-weight:600;color:${INK};text-decoration:none">${esc(m.title)}</a></div>`,
        `<div style="margin-top:3px;font-size:13px;color:${MUTED}">${esc(metaLine(m))}</div>`,
        ...(warm
          ? [`<div style="margin-top:3px;font-size:13px;color:${MUTED}">${esc(warm)}</div>`]
          : []),
        ...(m.reason?.trim()
          ? [`<p style="margin:6px 0 0;font-size:14px;line-height:1.45;color:${INK}">${esc(m.reason.trim())}</p>`]
          : []),
        `</div>`,
      ].join("");
    })
    .join("");

  const html = [
    `<div style="font-family:${FONT};max-width:560px;color:${INK}">`,
    `<div style="font-size:14px;font-weight:700;letter-spacing:.01em;color:${INK}">${BRAND_NAME}</div>`,
    `<p style="margin:14px 0 4px;font-size:15px">You have <strong>${matches.length}</strong> new role${plural} matched to you today.</p>`,
    rows,
    ...(more > 0
      ? [`<p style="margin:14px 0 0;font-size:14px;color:${MUTED}">...and ${more} more.</p>`]
      : []),
    `<p style="margin:18px 0 0;font-size:14px"><a href="${esc(appUrl)}" style="color:${INK}">See them all</a></p>`,
    `</div>`,
  ].join("");

  return { text, html };
}
