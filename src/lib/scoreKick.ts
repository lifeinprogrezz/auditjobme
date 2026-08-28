// The first-minute kick (issue #149) — pure half.
//
// The backlog worker is fired by .github/workflows/score-backlog.yml every 10
// minutes on paper. GitHub throttles free-plan schedules, and on 2026-08-26 it
// actually ran at 11:50, 12:52, 13:54 and 14:44: about once an hour. A new user
// who saved a CV at 14:43 waited over an hour for a first score. api/score-kick.ts
// closes that gap by draining THAT user's backlog on demand.
//
// Everything here is the part that can be decided without a network call, so it
// is unit-testable: who may call, and how often. Pinned by
// src/test/score-kick.test.ts.
//
// Two rules the endpoint must never break, both enforced from here:
//   1. CRON_SECRET stays server-side. The browser proves who it is with the
//      user's own Supabase JWT; the endpoint verifies it with the service-role
//      client and drains for THAT user id only. An anonymous caller spends
//      nothing because there is no user to spend for.
//   2. One kick per user per KICK_COOLDOWN_MS. The limiter is in-memory, so it
//      is best-effort across warm Vercel instances. It bounds the common case
//      (a save button pressed repeatedly); the real spend ceiling stays the
//      global monthly cap in the proxy edge function, which this cannot touch.
//
// Client-import-free, and the .js specifiers in the api/ importer are
// load-bearing — see the header of scorePrefilter.ts.

/** One kick per user per two minutes. A drain covers the whole backlog, so a
 *  second kick inside that window can only re-read what the first is already
 *  scoring. */
export const KICK_COOLDOWN_MS = 120_000;

/**
 * A kick that NAMES one role gets its own, shorter window (Rober, 2026-08-28:
 * "if someone starts to look for something in concrete the user can ask for score
 * this specific role").
 *
 * It cannot share the two-minute window: a person who asks for one role and then
 * spots a second would be refused, and the button would look broken. It cannot be
 * unlimited either, because every kick drains that user's whole backlog behind the
 * named role. Fifteen seconds is slower than a person clicking through cards and
 * fast enough that asking never feels blocked.
 */
export const PRIORITY_KICK_COOLDOWN_MS = 15_000;

/**
 * Is this a job id the endpoint may act on? A uuid and nothing else — the value
 * reaches a database filter, so an unrecognised shape is refused here rather than
 * passed along. An absent id is legal: that is an ordinary whole-backlog kick.
 */
export function priorityJobId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) ? v : null;
}

/** The token out of an `Authorization: Bearer <jwt>` header. Null when the header
 *  is absent, repeated (an array), or not a Bearer header. */
export function bearerToken(header: string | string[] | undefined | null): string | null {
  if (typeof header !== "string") return null;
  const m = /^Bearer (.+)$/.exec(header.trim());
  const token = m?.[1]?.trim();
  return token ? token : null;
}

/** The error response for everything judgeable before the JWT is verified, or
 *  null when the request may proceed. POST only: a kick spends money, so it must
 *  never be reachable from a link, an image tag or a prefetch. */
export function kickRequestError(
  method: string | undefined | null,
  token: string | null,
): { status: number; error: string } | null {
  if ((method ?? "").toUpperCase() !== "POST") return { status: 405, error: "Method not allowed" };
  if (!token) return { status: 401, error: "Unauthorized" };
  return null;
}

export type KickVerdict = { allowed: boolean; retryAfterMs: number };

export type KickLimiter = {
  /** Record and judge one kick for `userId` at `nowMs`. Allowed kicks are stamped;
   *  refused ones are not, so the window is measured from the last kick that ran. */
  take: (userId: string, nowMs: number) => KickVerdict;
  /** Entries currently held — the bound the prune keeps. Test seam. */
  size: () => number;
};

/**
 * Per-user cooldown over an in-memory map. Time is injected, never read from a
 * clock, so the whole rule is testable.
 *
 * The map is pruned on every take: an entry older than the cooldown can no longer
 * refuse anything, so keeping it would only grow the function's memory for as long
 * as the instance stays warm.
 */
export function createKickLimiter(cooldownMs: number = KICK_COOLDOWN_MS): KickLimiter {
  const lastKickAt = new Map<string, number>();
  return {
    take(userId: string, nowMs: number): KickVerdict {
      for (const [id, at] of lastKickAt) {
        if (nowMs - at >= cooldownMs) lastKickAt.delete(id);
      }
      const previous = lastKickAt.get(userId);
      if (previous !== undefined && nowMs - previous < cooldownMs) {
        return { allowed: false, retryAfterMs: cooldownMs - (nowMs - previous) };
      }
      lastKickAt.set(userId, nowMs);
      return { allowed: true, retryAfterMs: 0 };
    },
    size: () => lastKickAt.size,
  };
}
