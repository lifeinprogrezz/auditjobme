// Pure application-status helpers for the Tracker kanban (issue #42, hardened in #54).
// No React/supabase imports — pinned by tracker.test.ts. Rule + code move together.

export const TRACKER_COLUMNS = [
  { value: "applied", label: "Applied" },
  { value: "responded", label: "Responded" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
] as const;

export type Status = (typeof TRACKER_COLUMNS)[number]["value"];

export const STATUS_ORDER: Status[] = TRACKER_COLUMNS.map((c) => c.value);

/**
 * A DB status we recognise, or null when it isn't one of our columns. Unknown statuses
 * are NOT coerced to "applied" (issue #54): coercion silently misplaces a card onto the
 * wrong column, misrepresenting where an application actually stands. The Tracker drops
 * unrecognised rows with a warning rather than fabricate a stage for them.
 */
export function normStatus(s: string): Status | null {
  return (STATUS_ORDER as readonly string[]).includes(s) ? (s as Status) : null;
}

/**
 * Statuses where an application is still LIVE at that company (issue #73 slice 2 —
 * the career-ops in-flight semantics, ported exactly). While one of these is open,
 * that company's OTHER roles collapse out of the action queue: a second application
 * splits the recruiter's attention and reads as scattershot.
 *
 * "rejected" is deliberately NOT here. A closed conversation frees the company to
 * resurface on a genuinely NEW role — this is cap-1, not deprioritization. The
 * exact role you applied to never returns either way (that's the role-level
 * `applied` set, which already worked).
 */
export const INFLIGHT_STATUSES: Status[] = ["applied", "responded", "interview", "offer"];

/** True when this raw DB status means an application is still in flight. An
 *  unrecognised status is NOT in flight (normStatus's no-coercion rule): we never
 *  hide a company's roles on a status we can't identify. */
export function isInFlightStatus(status: string | null | undefined): boolean {
  const s = status == null ? null : normStatus(status);
  return s != null && INFLIGHT_STATUSES.includes(s);
}
