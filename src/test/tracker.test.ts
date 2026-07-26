// Pins normStatus (issue #54): a DB status the board doesn't recognise must NOT be
// coerced to "applied" (which silently misplaces the card) — it returns null so the
// Tracker can drop it with a warning instead of fabricating a stage.
import { describe, it, expect } from "vitest";
import { INFLIGHT_STATUSES, isInFlightStatus, normStatus, STATUS_ORDER, TRACKER_COLUMNS } from "@/lib/tracker";

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

// Issue #73 slice 2: which statuses collapse a COMPANY out of the action queue.
// The career-ops semantics, ported exactly — a rejected company must come back.
describe("isInFlightStatus", () => {
  it("treats every live conversation stage as in flight", () => {
    for (const s of ["applied", "responded", "interview", "offer"]) expect(isInFlightStatus(s)).toBe(true);
    expect(INFLIGHT_STATUSES).toEqual(["applied", "responded", "interview", "offer"]);
  });

  it("REJECTED is not in flight — the company resurfaces on a new role", () => {
    expect(isInFlightStatus("rejected")).toBe(false);
    expect(INFLIGHT_STATUSES).not.toContain("rejected");
  });

  it("never guesses on a status it can't identify (no coercion, same rule as normStatus)", () => {
    expect(isInFlightStatus("ghosted")).toBe(false);
    expect(isInFlightStatus("Applied")).toBe(false);
    expect(isInFlightStatus("")).toBe(false);
    expect(isInFlightStatus(null)).toBe(false);
    expect(isInFlightStatus(undefined)).toBe(false);
  });
});
