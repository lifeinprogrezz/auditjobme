// Pins normStatus (issue #54): a DB status the board doesn't recognise must NOT be
// coerced to "applied" (which silently misplaces the card) — it returns null so the
// Tracker can drop it with a warning instead of fabricating a stage.
import { describe, it, expect } from "vitest";
import { normStatus, STATUS_ORDER, TRACKER_COLUMNS } from "@/lib/tracker";

describe("normStatus", () => {
  it("passes every known column status straight through", () => {
    for (const s of STATUS_ORDER) expect(normStatus(s)).toBe(s);
  });

  it("returns null for an unknown status instead of coercing to 'applied'", () => {
    expect(normStatus("screening")).toBeNull();
    expect(normStatus("ghosted")).toBeNull();
    expect(normStatus("")).toBeNull();
    expect(normStatus("Applied")).toBeNull(); // case-sensitive: only the canonical values pass
  });

  it("keeps the column ladder and its order in one source of truth", () => {
    expect(STATUS_ORDER).toEqual(TRACKER_COLUMNS.map((c) => c.value));
    expect(STATUS_ORDER[0]).toBe("applied");
    expect(STATUS_ORDER[STATUS_ORDER.length - 1]).toBe("rejected");
  });
});
