import { describe, it, expect } from "vitest";
import { parseScoreResponse } from "@/lib/score";
import {
  buildScoreUserMessage,
  buildScoreSystem,
  normalizeRoleFamily,
  ROLE_FAMILY_LABELS,
  FAMILY_FIT_BLOCKS,
  blendSubscores,
  groundEvidence,
  isGroundedQuote,
  SUBSCORE_WEIGHTS,
  SUBSCORE_KEYS,
  type ScoreableProfile,
  type ScoreableJob,
  type ScoreSubscore,
  type ScoreEvidence,
} from "@/lib/scorePrompt";

/** All five subscores at one value → the blend equals that value (weights sum to 1). */
const allSubs = (score: number): ScoreSubscore[] =>
  SUBSCORE_KEYS.map((key) => ({ key, score }));

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

  it("drops null/non-number subscore values instead of coercing them to 0", () => {
    // Number(null) === 0 would silently drag the blend to the floor for that
    // dimension; a null score must instead break the full-rubric requirement so
    // the caller falls back to the raw model score.
    const out = parseScoreResponse(
      '{"score":3.7,"reason":"ok","subscores":[{"key":"seniority","score":null},{"key":"geography","score":4},{"key":"work_auth","score":4},{"key":"language","score":4},{"key":"background","score":4}]}',
    );
    expect(out?.subscores?.map((s) => s.key)).toEqual(["geography", "work_auth", "language", "background"]);
    expect(out?.score).toBe(3.7); // partial rubric → raw model score, not a blend over a fake 0
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

// F1 Layer-1 (2026-07-12): the DISPLAY score is a deterministic blend of the five
// v4 subscores, not the model's single holistic 0-5. Weights are pinned here so a
// weight change and its test move together.
describe("blendSubscores (F1 Layer-1 deterministic recompute)", () => {
  it("weights sum to exactly 1 so the blend stays in [0, 5]", () => {
    const total = SUBSCORE_KEYS.reduce((s, k) => s + SUBSCORE_WEIGHTS[k], 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("returns the uniform value when every dimension shares it", () => {
    expect(blendSubscores(allSubs(4))).toBe(4);
    expect(blendSubscores(allSubs(0))).toBe(0);
    expect(blendSubscores(allSubs(5))).toBe(5);
  });

  it("weights the dimensions per SUBSCORE_WEIGHTS (background heaviest)", () => {
    // background=5, all others=0 → 5 * 0.30 = 1.5
    const subs: ScoreSubscore[] = SUBSCORE_KEYS.map((key) => ({
      key,
      score: key === "background" ? 5 : 0,
    }));
    expect(blendSubscores(subs)).toBe(1.5);
  });

  it("rounds to one decimal", () => {
    // seniority=5 (0.22), rest 0 → 1.1
    const subs: ScoreSubscore[] = SUBSCORE_KEYS.map((key) => ({
      key,
      score: key === "seniority" ? 5 : 0,
    }));
    expect(blendSubscores(subs)).toBe(1.1);
  });

  it("returns null unless ALL five dimensions are present", () => {
    expect(blendSubscores([])).toBeNull();
    expect(blendSubscores(allSubs(3).slice(0, 4))).toBeNull();
  });
});

describe("parseScoreResponse — blended score overrides the raw model score", () => {
  it("uses the deterministic blend when the full rubric is present", () => {
    const subs = SUBSCORE_KEYS.map((key) => ({ key, score: 4 }));
    const json = JSON.stringify({ score: 1.0, reason: "x", subscores: subs });
    // model said 1.0, but all-4 subscores blend to 4.0 → the display score is 4.0
    expect(parseScoreResponse(json)?.score).toBe(4);
  });

  it("falls back to the raw model score when subscores are partial / absent", () => {
    expect(parseScoreResponse('{"score":3.7,"reason":"x"}')?.score).toBe(3.7);
    const partial = '{"score":3.7,"reason":"x","subscores":[{"key":"seniority","score":5}]}';
    expect(parseScoreResponse(partial)?.score).toBe(3.7);
  });
});

// F1 Stage-2 (2026-07-12): cited evidence quotes are grounded — a quote that is not a
// real substring of the CV/JD is blanked, killing hallucinated citations.
describe("isGroundedQuote (Stage-2 substring verification)", () => {
  it("accepts a verbatim substring through case/whitespace/typography drift", () => {
    const cv = "Grew GMV to $375M across the marketplace.";
    expect(isGroundedQuote("grew gmv to $375m", cv)).toBe(true);
    expect(isGroundedQuote("Grew   GMV\nto $375M", cv)).toBe(true);
    expect(isGroundedQuote("marketplace", cv)).toBe(true);
  });

  it("rejects a phrase that never appears in the source", () => {
    expect(isGroundedQuote("led a team of 40 engineers", "Grew GMV to $375M.")).toBe(false);
  });

  it("treats an empty quote as grounded and any quote against an empty source as not", () => {
    expect(isGroundedQuote("", "anything")).toBe(true);
    expect(isGroundedQuote("something", "")).toBe(false);
  });
});

describe("groundEvidence (Stage-2 — blank hallucinated citations)", () => {
  const ev = (cvLine: string, jdPhrase: string): ScoreEvidence => ({
    label: "Factor",
    cvLine,
    jdPhrase,
    contribution: 0.5,
  });

  it("keeps real quotes and blanks fabricated ones, per side, keeping the label", () => {
    const out = groundEvidence(
      [ev("grew GMV to $375M", "hallucinated requirement")],
      { cvText: "I grew GMV to $375M last year.", jdText: "We need a two-sided marketplace PM." },
    );
    expect(out[0]).toEqual({ label: "Factor", cvLine: "grew GMV to $375M", jdPhrase: "", contribution: 0.5 });
  });

  it("does not verify a side whose source is not provided (can't check → keep)", () => {
    const out = groundEvidence([ev("unverifiable cv quote", "unverifiable jd quote")], {});
    expect(out[0].cvLine).toBe("unverifiable cv quote");
    expect(out[0].jdPhrase).toBe("unverifiable jd quote");
  });

  it("blanks a claimed quote when its source is provided but empty", () => {
    const out = groundEvidence([ev("some cv claim", "")], { cvText: "", jdText: "jd" });
    expect(out[0].cvLine).toBe("");
  });
});

describe("parseScoreResponse — grounds evidence when sources are supplied", () => {
  it("blanks a hallucinated cv_line but keeps a real jd_phrase", () => {
    const json = JSON.stringify({
      score: 4,
      reason: "ok",
      evidence: [{ label: "Marketplace", cv_line: "invented CV line", jd_phrase: "two-sided marketplace", contribution: 0.8 }],
    });
    const out = parseScoreResponse(json, {
      cvText: "PM who scaled a fintech app.",
      jdText: "You will own our two-sided marketplace roadmap.",
    });
    expect(out?.evidence[0].cvLine).toBe("");
    expect(out?.evidence[0].jdPhrase).toBe("two-sided marketplace");
  });

  it("leaves evidence untouched when no sources are passed (existing callers)", () => {
    const json = '{"score":4,"reason":"ok","evidence":[{"label":"X","cv_line":"anything","jd_phrase":"y","contribution":0.2}]}';
    expect(parseScoreResponse(json)?.evidence[0].cvLine).toBe("anything");
  });
});

// #34 all-vertical: the scoring system prompt is a shared core + the row's
// role-family fit block. These pin the un-hard-wiring of "a Product Manager role".
describe("buildScoreSystem — shared core + per-family fit block (#34)", () => {
  it("null / absent / unknown role_family falls back to the product family", () => {
    expect(normalizeRoleFamily(null)).toBe("product");
    expect(normalizeRoleFamily(undefined)).toBe("product");
    expect(normalizeRoleFamily("something-else")).toBe("product");
    expect(buildScoreSystem(null)).toBe(buildScoreSystem("product"));
    expect(buildScoreSystem(null)).toContain("a Product Manager role");
  });

  it("each family gets its own opening line and its own fit block", () => {
    const families = Object.keys(ROLE_FAMILY_LABELS) as (keyof typeof ROLE_FAMILY_LABELS)[];
    for (const family of families) {
      const system = buildScoreSystem(family);
      expect(system).toContain(FAMILY_FIT_BLOCKS[family]);
      // Exactly one family's fit block — never a mix.
      for (const other of families) {
        if (other !== family) expect(system).not.toContain(FAMILY_FIT_BLOCKS[other]);
      }
    }
    expect(buildScoreSystem("engineering")).toContain("an Engineering role");
    expect(buildScoreSystem("sales")).toContain("a Sales role");
  });

  it("the response contract is shared core: identical JSON shape across families", () => {
    const contract = (s: string) => s.slice(s.indexOf("Return ONLY a JSON object"));
    const product = contract(buildScoreSystem("product"));
    expect(product).toContain('"subscores"');
    for (const family of ["engineering", "sales", "marketing", "operations"]) {
      expect(contract(buildScoreSystem(family))).toBe(product);
    }
  });

  it("the weighing order (shared core) is identical across families", () => {
    const weighing = 'Weigh, in roughly this order:';
    for (const family of Object.keys(ROLE_FAMILY_LABELS)) {
      expect(buildScoreSystem(family)).toContain(weighing);
    }
  });
});
