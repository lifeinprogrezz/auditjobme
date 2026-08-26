// Pins the three-state score presentation (#114 follow-up). Before the
// prefilter every unscored role was genuinely mid-pass, so "Scoring this role…"
// was always true. Now a role outside the paid slice never scores, and that copy
// would be a permanent lie — scoreStatusOf is the one place that distinction is
// decided, so no surface can drift back into claiming work that will not happen.
import { describe, expect, it } from "vitest";
import { pendingLabelOf, scoreStatusOf } from "@/lib/scorePrefilter";

// Issue #130: a role with no readable description is never scored, by any path,
// and an older score it may still hold is not shown. The status names that state
// so the copy can say why, instead of "Scoring" (never true) or "Not scored"
// (points at Settings, which cannot fix it).
describe("scoreStatusOf — no description (#130)", () => {
  it("reports a JD-less role as no-description, whatever the slice says", () => {
    expect(scoreStatusOf(null, true, false)).toBe("no-description");
    expect(scoreStatusOf(null, false, false)).toBe("no-description");
  });

  it("hides a stale score a JD-less role still holds", () => {
    expect(scoreStatusOf(4.2, true, false)).toBe("no-description");
  });

  it("defaults readable to true so existing call sites keep their meaning", () => {
    expect(scoreStatusOf(null, true)).toBe("scoring");
  });
});

describe("pendingLabelOf", () => {
  it("maps every pending status to plain copy", () => {
    expect(pendingLabelOf("scoring")).toBe("Scoring");
    expect(pendingLabelOf("not-scored")).toBe("Not scored yet");
    expect(pendingLabelOf("no-description")).toBe("No description yet");
  });
});

describe("scoreStatusOf", () => {
  it("reports a scored role as scored, eligible or not", () => {
    expect(scoreStatusOf(4.2, true)).toBe("scored");
    // A role can hold a score from an earlier, wider label selection.
    expect(scoreStatusOf(4.2, false)).toBe("scored");
    expect(scoreStatusOf(0, true)).toBe("scored"); // zero is a real score, not absence
  });

  it("reports an unscored role INSIDE the paid slice as still scoring", () => {
    expect(scoreStatusOf(null, true)).toBe("scoring");
  });

  it("reports an unscored role OUTSIDE the paid slice as not scored, never scoring", () => {
    expect(scoreStatusOf(null, false)).toBe("not-scored");
  });
});
