import { describe, it, expect } from "vitest";
import { parseScoreResponse } from "@/lib/score";

describe("parseScoreResponse", () => {
  it("parses a clean JSON object", () => {
    expect(parseScoreResponse('{"score": 4.2, "reason": "strong fit"}')).toEqual({
      score: 4.2,
      reason: "strong fit",
    });
  });

  it("extracts JSON embedded in surrounding prose", () => {
    expect(parseScoreResponse('Here you go: {"score": 3, "reason": "ok"} done')).toEqual({
      score: 3,
      reason: "ok",
    });
  });

  it("clamps a score above 5 down to 5", () => {
    expect(parseScoreResponse('{"score": 9, "reason": "x"}')?.score).toBe(5);
  });

  it("clamps a negative score up to 0", () => {
    expect(parseScoreResponse('{"score": -3, "reason": "x"}')?.score).toBe(0);
  });

  it("returns null for a non-numeric score", () => {
    expect(parseScoreResponse('{"score": "high", "reason": "x"}')).toBeNull();
  });

  it("returns null when there is no JSON at all", () => {
    expect(parseScoreResponse("the model refused to answer")).toBeNull();
  });

  it("returns null for malformed JSON (trailing comma)", () => {
    expect(parseScoreResponse('{"score": 4, "reason": "x",}')).toBeNull();
  });

  it("defaults reason to empty string when missing", () => {
    expect(parseScoreResponse('{"score": 2}')).toEqual({ score: 2, reason: "" });
  });
});
