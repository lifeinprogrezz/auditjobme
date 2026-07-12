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
