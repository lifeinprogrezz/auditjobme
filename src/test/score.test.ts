import { describe, it, expect } from "vitest";
import { parseScoreResponse } from "@/lib/score";
import {
  buildScoreUserMessage,
  type ScoreableProfile,
  type ScoreableJob,
} from "@/lib/scorePrompt";

describe("parseScoreResponse", () => {
  it("parses a clean JSON object", () => {
    expect(parseScoreResponse('{"score": 4.2, "reason": "strong fit"}')).toEqual({
      score: 4.2,
      reason: "strong fit",
      fitBullets: [],
      subscores: [],
      evidence: [],
    });
  });

  it("extracts JSON embedded in surrounding prose", () => {
    expect(parseScoreResponse('Here you go: {"score": 3, "reason": "ok"} done')).toEqual({
      score: 3,
      reason: "ok",
      fitBullets: [],
      subscores: [],
      evidence: [],
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
    expect(parseScoreResponse('{"score": 2}')).toEqual({
      score: 2,
      reason: "",
      fitBullets: [],
      subscores: [],
      evidence: [],
    });
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


// v4 (Track D S2, 2026-07-11): explainable-score data contract — subscores per rubric
// dimension + cited evidence. Both degrade to [] so pre-v4 responses stay parseable.
describe("parseScoreResponse — v4 subscores + evidence", () => {
  it("parses well-formed subscores and clamps each into [0, 5]", () => {
    const out = parseScoreResponse(
      '{"score":4,"reason":"ok","subscores":[{"key":"seniority","score":7},{"key":"geography","score":-1},{"key":"background","score":3.5}]}',
    );
    expect(out?.subscores).toEqual([
      { key: "seniority", score: 5 },
      { key: "geography", score: 0 },
      { key: "background", score: 3.5 },
    ]);
  });

  it("drops unknown subscore keys, non-numeric scores, and duplicate keys", () => {
    const out = parseScoreResponse(
      '{"score":3,"reason":"ok","subscores":[{"key":"vibes","score":5},{"key":"language","score":"high"},{"key":"language","score":4},{"key":"language","score":1},"junk",null]}',
    );
    expect(out?.subscores).toEqual([{ key: "language", score: 4 }]);
  });

  it("parses evidence, clamps contribution into [-1, 1], and coerces missing quotes to empty strings", () => {
    const out = parseScoreResponse(
      '{"score":4,"reason":"ok","evidence":[{"label":"Marketplace experience","cv_line":" grew GMV to $375M ","jd_phrase":"two-sided marketplace","contribution":3},{"label":"Seniority gap","contribution":-2}]}',
    );
    expect(out?.evidence).toEqual([
      { label: "Marketplace experience", cvLine: "grew GMV to $375M", jdPhrase: "two-sided marketplace", contribution: 1 },
      { label: "Seniority gap", cvLine: "", jdPhrase: "", contribution: -1 },
    ]);
  });

  it("drops label-less evidence items, defaults contribution to 0, and caps at 6", () => {
    const items = Array.from({ length: 8 }, (_, i) => `{"label":"factor ${i}","contribution":"n/a"}`).join(",");
    const out = parseScoreResponse(`{"score":2,"reason":"ok","evidence":[{"cv_line":"orphan"},null,${items}]}`);
    expect(out?.evidence).toHaveLength(6);
    expect(out?.evidence[0]).toEqual({ label: "factor 0", cvLine: "", jdPhrase: "", contribution: 0 });
  });

  it("tolerates subscores / evidence that aren't arrays (pre-v4 shape)", () => {
    const out = parseScoreResponse('{"score":3,"reason":"ok","subscores":"nope","evidence":{"a":1}}');
    expect(out?.subscores).toEqual([]);
    expect(out?.evidence).toEqual([]);
  });
});

// Slice-3 (Rober 2026-07-09): the scorer is GROUNDED on JD-extracted facts — it reads
// the cite-anchored yoe_min / geo_eligibility instead of re-deriving them from prose.
// Same builder for the live /roles reveal AND the nightly email, so scores never diverge.
describe("buildScoreUserMessage — JD-extracted grounding (slice 3)", () => {
  const profile: ScoreableProfile = {
    target_seniority: "senior",
    target_cities: ["London"],
    open_to_remote: true,
    citizenship: "Spain",
    eu_work_authorized: true,
    languages: ["English"],
    cv_text: "Product manager CV",
  };
  const baseJob: ScoreableJob = {
    id: "1",
    company: "Acme",
    title: "Product Manager",
    location: "London",
    remote: false,
    seniority: "senior",
    jd_text: "Build product.",
  };

  it("injects the extracted YoE + geo-eligibility lines when present", () => {
    const msg = buildScoreUserMessage(profile, { ...baseJob, yoe_min: 12, geo_eligibility: "UK" });
    expect(msg).toContain("- experience required (extracted from JD): 12+ years");
    expect(msg).toContain("- work eligibility (extracted from JD): UK");
  });

  it("FAIL-OPEN: omits both lines when the extraction is silent", () => {
    const msg = buildScoreUserMessage(profile, { ...baseJob, yoe_min: null, geo_eligibility: null });
    expect(msg).not.toContain("experience required (extracted");
    expect(msg).not.toContain("work eligibility (extracted");
  });

  it("injects each fact independently", () => {
    const yoeOnly = buildScoreUserMessage(profile, { ...baseJob, yoe_min: 5 });
    expect(yoeOnly).toContain("- experience required (extracted from JD): 5+ years");
    expect(yoeOnly).not.toContain("work eligibility (extracted");
  });
});
