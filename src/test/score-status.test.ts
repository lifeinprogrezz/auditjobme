// Pins the three-state score presentation (#114 follow-up). Before the
// prefilter every unscored role was genuinely mid-pass, so "Scoring this role…"
// was always true. Now a role outside the paid slice never scores, and that copy
// would be a permanent lie — scoreStatusOf is the one place that distinction is
// decided, so no surface can drift back into claiming work that will not happen.
import { describe, expect, it } from "vitest";
import { scoreStatusOf } from "@/lib/scorePrefilter";

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
