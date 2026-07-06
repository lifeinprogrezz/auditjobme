import { describe, it, expect } from "vitest";
import { parseScoreResponse } from "@/lib/score";

describe("parseScoreResponse", () => {
  it("parses a clean JSON object", () => {
    expect(parseScoreResponse('{"score": 4.2, "reason": "strong fit"}')).toEqual({
      score: 4.2,
      reason: "strong fit",
      fitBullets: [],
    });
  });

  it("extracts JSON embedded in surrounding prose", () => {
    expect(parseScoreResponse('Here you go: {"score": 3, "reason": "ok"} done')).toEqual({
      score: 3,
      reason: "ok",
      fitBullets: [],
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

  it("defaults reason to empty string and fitBullets to [] when missing", () => {
    expect(parseScoreResponse('{"score": 2}')).toEqual({ score: 2, reason: "", fitBullets: [] });
  });

  it("parses fit_bullets, trims them, and caps at 5", () => {
    const out = parseScoreResponse(
      '{"score":4.5,"reason":"great","fit_bullets":["  a ","b","c","d","e","f"]}',
    );
    expect(out?.fitBullets).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("drops non-string / empty bullets", () => {
    const out = parseScoreResponse(
      '{"score":3,"reason":"ok","fit_bullets":["real", "", 42, null, "  ", "also real"]}',
    );
    expect(out?.fitBullets).toEqual(["real", "also real"]);
  });

  it("tolerates fit_bullets that isn't an array", () => {
    expect(parseScoreResponse('{"score":3,"reason":"ok","fit_bullets":"nope"}')?.fitBullets).toEqual([]);
  });
});
