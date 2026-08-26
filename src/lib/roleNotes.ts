// src/lib/roleNotes.ts — the READ side of the per-role "anything specific for
// this one?" box (issue #76, persistence added issue #151 / D4).
//
// The box already fed every generated artifact's prompt through `context` on
// the artifact row (tailor.ts buildContextBlock). What was missing: the box was
// never read back, and was cleared on every page load. This file picks the
// right value to reload — the most recently updated artifact row for the role,
// whichever kind saved it (the explicit Save button below, or a CV/letter/answer
// generation that carried the box as a side effect, same as before).
//
// Pure — no network, no Date.now() — so the test can hand it any two rows and
// know exactly which one wins.

/** The artifact kind the Save button / autosave-on-blur write to, independent
 *  of generating a CV, letter, or answer (issue #151). Content stays `{}`; the
 *  note lives in the `context` column, same as every other artifact kind. */
export const NOTES_KIND = "notes";

export type ArtifactContextRow = { context: string | null; updated_at: string };

/** The most recently updated row's context, or "" when there are no rows or
 *  the latest row never had one. */
export function latestRoleContext(rows: ArtifactContextRow[]): string {
  if (rows.length === 0) return "";
  const latest = rows.reduce((a, b) => (new Date(b.updated_at).getTime() > new Date(a.updated_at).getTime() ? b : a));
  return latest.context ?? "";
}

// ── WRITE side (issue #151 fix round 1, D4 blockers 1+2) ────────────────────
//
// The Save button / autosave-on-blur used to `upsert(..., { onConflict:
// "user_id,job_id,kind" })`. The only (user_id, job_id, kind) unique index is
// PARTIAL (`artifacts_user_job_kind_idx ... where job_id is not null`) — Postgres
// will not infer a partial index as an ON CONFLICT arbiter without a matching
// WHERE clause, which PostgREST cannot send, so the write always failed with
// 42P10. `saveArtifact` (same PR that added the index) already does delete+insert
// for exactly this reason; the notes write now mirrors it.
//
// delete+insert also fixes the READ side: `artifacts.updated_at` has a default
// but no trigger, so a plain upsert never bumped it and a stale notes row could
// outlast a newer cv/letter/answers row in `latestRoleContext` above. An insert
// gets a fresh `updated_at` — left to the DB's `now()` default, same as
// `saveArtifact`'s cv/letter/answers insert, NOT stamped from the client clock.
// A notes row and a saveArtifact row must share one clock: two different
// clocks (client vs DB) can be minutes apart, and whichever row happens to
// land on the "later" clock wins `latestRoleContext` regardless of which was
// actually typed last — the exact "typed and lost" scenario D4 exists to fix.

export type NotesWriteRow = {
  user_id: string;
  job_id: string;
  kind: string;
  content: Record<string, never>;
  context: string | null;
};

// content is always `{}` for a notes row — the note itself lives in `context`
// (issue #76). `Record<string, never>` types that literal precisely and is
// structurally assignable to the generated `Json` type on the artifacts table.

/** The delete filter — scoped to this user, this job, and the `notes` kind
 *  only, so a save never touches the cv/letter/answers rows for the same role. */
export function buildNotesDeleteMatch(userId: string, jobId: string): { user_id: string; job_id: string; kind: string } {
  return { user_id: userId, job_id: jobId, kind: NOTES_KIND };
}

/** The row to insert right after the delete above. No `updated_at` here — the
 *  DB default stamps it, same clock every other artifact kind's insert uses. */
export function buildNotesInsertRow(userId: string, jobId: string, context: string): NotesWriteRow {
  return { user_id: userId, job_id: jobId, kind: NOTES_KIND, content: {}, context: context.trim() || null };
}
