import { describe, it, expect } from "vitest";
import { latestRoleContext, NOTES_KIND, buildNotesDeleteMatch, buildNotesInsertRow } from "./roleNotes";

describe("latestRoleContext — the round trip the Save button and page load depend on", () => {
  it("returns \"\" when there are no artifact rows for the role", () => {
    expect(latestRoleContext([])).toBe("");
  });

  it("picks the most recently updated row's context, regardless of kind", () => {
    const rows = [
      { context: "an old note from generating the CV", updated_at: "2026-08-20T10:00:00.000Z" },
      { context: "the latest note, saved by the Save button", updated_at: "2026-08-26T09:00:00.000Z" },
      { context: "a note from generating the cover letter", updated_at: "2026-08-22T10:00:00.000Z" },
    ];
    expect(latestRoleContext(rows)).toBe("the latest note, saved by the Save button");
  });

  it("returns \"\" when the most recent row cleared the note (saved blank)", () => {
    const rows = [
      { context: "an earlier note", updated_at: "2026-08-20T10:00:00.000Z" },
      { context: null, updated_at: "2026-08-26T09:00:00.000Z" },
    ];
    expect(latestRoleContext(rows)).toBe("");
  });

  it("is order-independent — the same rows in a different order pick the same winner", () => {
    const a = { context: "first", updated_at: "2026-08-20T10:00:00.000Z" };
    const b = { context: "second, and newer", updated_at: "2026-08-25T10:00:00.000Z" };
    expect(latestRoleContext([a, b])).toBe(latestRoleContext([b, a]));
    expect(latestRoleContext([a, b])).toBe("second, and newer");
  });

  it("NOTES_KIND is the dedicated artifact kind for a save with no generation", () => {
    expect(NOTES_KIND).toBe("notes");
  });
});

describe("buildNotesDeleteMatch / buildNotesInsertRow — the delete+insert write round trip (issue #151 fix round 1, blockers 1+2)", () => {
  it("delete match scopes to this user, this job, and the notes kind only — never touches cv/letter/answers rows", () => {
    expect(buildNotesDeleteMatch("u1", "j1")).toEqual({ user_id: "u1", job_id: "j1", kind: NOTES_KIND });
  });

  it("insert row stamps a fresh updated_at, so a later notes save always outranks an earlier generation row", () => {
    const row = buildNotesInsertRow("u1", "j1", "call it back Tuesday", () => "2026-08-26T12:00:00.000Z");
    expect(row).toEqual({
      user_id: "u1",
      job_id: "j1",
      kind: NOTES_KIND,
      content: {},
      context: "call it back Tuesday",
      updated_at: "2026-08-26T12:00:00.000Z",
    });
    // The exact "typed and lost" scenario D4 exists to fix: save note A, then
    // generate a CV (carries A, newer at the time) — the notes row's OWN save
    // used to never bump its updated_at, so a later edit could still lose to
    // the older generation row. With a fresh stamp on every insert, it can't.
    const rows = [
      { context: "an old note from generating the CV", updated_at: "2026-08-20T10:00:00.000Z" },
      row,
    ];
    expect(latestRoleContext(rows)).toBe("call it back Tuesday");
  });

  it("blank context saves as null, same as the old upsert payload did", () => {
    expect(buildNotesInsertRow("u1", "j1", "   ", () => "2026-08-26T12:00:00.000Z").context).toBeNull();
  });
});
