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
