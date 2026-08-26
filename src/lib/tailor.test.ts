import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildSummaryPrompt,
  buildCoverPrompt,
  buildAnswerPrompt,
  buildCommonPackPrompt,
  noEmDash,
  MAX_ANSWERS,
  COMMON_PACK_QUESTIONS,
  COVER_MIN_WORDS,
  COVER_MAX_WORDS,
  wordCount,
  coverBodyWordCount,
  isCoverLengthOk,
  parseCoverJson,
  parseCommonPackJson,
  tailorCover,
  answerCommonPack,
} from "./tailor";
import { stripLeadingSummary } from "./cvHtml";

// The transport is a separate module (issue #151) precisely so tailorCover's
// retry logic and answerCommonPack's parse can be tested without a real network
// call or a Supabase session — see src/lib/proxy.ts.
const callProxyMock = vi.fn();
vi.mock("./proxy", () => ({
  callProxy: (...args: unknown[]) => callProxyMock(...args),
  HAIKU: "test-haiku-model",
}));

const CV = `John Doe
john@example.com

Professional Experience

Acme Corp — Product Manager — 2021-2024
- Grew activation 40% by shipping onboarding redesign
- Led a team of 5

Education
BSc Computer Science, MIT`;

describe("tailor prompts", () => {
  it("summary prompt carries role, company, CV facts, and the hard rules", () => {
    const p = buildSummaryPrompt({ role: "Senior PM", company: "Acme", jdText: "Own the roadmap", cvText: CV });
    expect(p).toContain("Senior PM at Acme");
    expect(p).toContain("Own the roadmap");
    expect(p).toContain("Grew activation 40%");
    expect(p).toContain("FIRST PERSON");
    expect(p.toLowerCase()).toContain("no em-dashes");
    expect(p).toContain("Use ONLY facts");
  });

  it("cover prompt requests JSON, forbids em-dashes, guards numbers and availability, and signs with the candidate name (issue #151 / D2)", () => {
    const p = buildCoverPrompt({ role: "PM", company: "Acme", jdText: "", cvText: CV }, "John Doe");
    expect(p).toContain("greeting, p1, p2, p3, sign");
    expect(p).toContain("NO em-dashes");
    expect(p).toContain("John Doe");
    // Ported from the personal engine's summary guardrail (career-ops tailor-cv.mjs
    // buildSummary), which the cover prompt never carried before this issue.
    expect(p).toContain("re-label or re-attribute");
    // New: never invent relocation, a visa, or a dated availability.
    expect(p.toLowerCase()).toContain("relocation");
    expect(p.toLowerCase()).toContain("dated availability");
  });

  it("cover prompt appends the retry hint only when a previous word count is supplied", () => {
    const base = buildCoverPrompt({ role: "PM", company: "Acme", jdText: "", cvText: CV }, "John Doe");
    const retry = buildCoverPrompt({ role: "PM", company: "Acme", jdText: "", cvText: CV }, "John Doe", 95);
    expect(base).not.toContain("Your previous draft was");
    expect(retry).toContain("Your previous draft was 95 words");
    expect(retry).toContain("120 and 180 words");
  });

  it("answer prompt carries the question, CV facts, and the grounding rules", () => {
    const p = buildAnswerPrompt(
      { role: "Senior PM", company: "Acme", jdText: "Own the roadmap", cvText: CV },
      "Why do you want to work at Acme?",
    );
    expect(p).toContain("Why do you want to work at Acme?");
    expect(p).toContain("Senior PM at Acme");
    expect(p).toContain("Grew activation 40%");
    expect(p).toContain("Use ONLY facts");
    expect(p).toContain("Never fabricate");
    expect(p).toContain("FIRST PERSON");
    expect(p.toLowerCase()).toContain("no em-dashes");
    expect(p).toContain("120-180 words");
  });

  it("common pack prompt lists the four questions in order and the JSON contract (issue #151 / D4)", () => {
    const p = buildCommonPackPrompt({ role: "PM", company: "Acme", jdText: "Own the roadmap", cvText: CV });
    expect(p).toContain("PM at Acme");
    expect(p).toContain("Own the roadmap");
    for (const q of COMMON_PACK_QUESTIONS) expect(p).toContain(q.label);
    expect(p).toContain("whyCompany, whyFit, productShipped, measureSuccess");
    expect(p).toContain("re-label or re-attribute");
    expect(p.toLowerCase()).toContain("no em-dashes");
  });

  it("answer cap is bounded and leaves the manual flow its full 8 after the common pack's 4 (issue #151)", () => {
    expect(MAX_ANSWERS).toBe(12);
    expect(MAX_ANSWERS).toBeGreaterThanOrEqual(COMMON_PACK_QUESTIONS.length + 8);
  });

  it("no-context invariant — omitting context leaves every prompt byte-identical (issue #76)", () => {
    const withoutField = buildSummaryPrompt({ role: "Senior PM", company: "Acme", jdText: "Own the roadmap", cvText: CV });
    const explicitUndefined = buildSummaryPrompt({
      role: "Senior PM",
      company: "Acme",
      jdText: "Own the roadmap",
      cvText: CV,
      context: undefined,
    });
    const explicitNull = buildSummaryPrompt({
      role: "Senior PM",
      company: "Acme",
      jdText: "Own the roadmap",
      cvText: CV,
      context: null,
    });
    const emptyString = buildSummaryPrompt({
      role: "Senior PM",
      company: "Acme",
      jdText: "Own the roadmap",
      cvText: CV,
      context: "",
    });
    const whitespaceOnly = buildSummaryPrompt({
      role: "Senior PM",
      company: "Acme",
      jdText: "Own the roadmap",
      cvText: CV,
      context: "   ",
    });
    expect(explicitUndefined).toBe(withoutField);
    expect(explicitNull).toBe(withoutField);
    expect(emptyString).toBe(withoutField);
    expect(whitespaceOnly).toBe(withoutField);
    // pinned golden — the exact prompt as it read before issue #76 shipped; an empty
    // box must reproduce this precisely, not merely "close enough"
    expect(withoutField).toBe(
      "You are writing the Professional Summary for ONE specific job application — the only part of the CV that changes per role. Make it concrete to THIS role; it should be impossible to reuse verbatim for a different job.\n\nWrite a summary that:\n- Leads with the angle THIS role cares about most, citing the 2-3 SPECIFIC achievements from the CV that best fit it (real employers, real numbers). Pick ONLY what genuinely fits the role.\n- Draws a clear line from the candidate's real, stated experience to what this role does.\n\nHARD RULES — do not break (this protects the candidate's credibility):\n- Use ONLY facts, responsibilities, and numbers that literally appear in the CV below. Do NOT invent or imply responsibilities the CV does not state.\n- Do NOT re-label or re-attribute any number. Keep every number's exact meaning and wording from the CV.\n- No fabrication of any kind. When unsure, stay closer to the CV's own wording.\n- Write in the FIRST PERSON (\"I\", or implied first person with no pronoun). NEVER refer to the candidate in the third person.\n- 3 to 5 sentences (about 80-120 words). Specific, substantive, tight. No buzzwords, no boilerplate that could describe any candidate.\n- Warm, honest. NO em-dashes at all (use commas or short sentences). Write in English.\n- You may bold 2-4 key figures with ** **.\n\nOUTPUT: the summary paragraph ONLY. No preamble, no analysis, no heading, no separators. Just the paragraph.\n\nROLE: Senior PM at Acme\n\nJOB DESCRIPTION:\nOwn the roadmap\n\nCANDIDATE CV (canonical facts; select the most relevant real proof from anywhere in it):\nJohn Doe\njohn@example.com\n\nProfessional Experience\n\nAcme Corp — Product Manager — 2021-2024\n- Grew activation 40% by shipping onboarding redesign\n- Led a team of 5\n\nEducation\nBSc Computer Science, MIT\n\nProfessional Summary:",
    );
  });

  it("passthrough — supplied context reaches all four prompts, with the use-not-invent guardrail (issue #76)", () => {
    const context = "Referred by Maria on the growth team; I've followed their embedded-finance launch closely.";
    const summaryPrompt = buildSummaryPrompt({
      role: "Senior PM",
      company: "Acme",
      jdText: "Own the roadmap",
      cvText: CV,
      context,
    });
    const coverPrompt = buildCoverPrompt(
      { role: "PM", company: "Acme", jdText: "", cvText: CV, context },
      "John Doe",
    );
    const answerPrompt = buildAnswerPrompt(
      { role: "Senior PM", company: "Acme", jdText: "Own the roadmap", cvText: CV, context },
      "Why do you want to work at Acme?",
    );
    const commonPackPrompt = buildCommonPackPrompt({
      role: "Senior PM",
      company: "Acme",
      jdText: "Own the roadmap",
      cvText: CV,
      context,
    });
    for (const p of [summaryPrompt, coverPrompt, answerPrompt, commonPackPrompt]) {
      expect(p).toContain(context);
      expect(p).toContain("Do NOT invent anything beyond what is stated here or in the CV");
    }
  });

  it("noEmDash replaces em-dashes with commas", () => {
    expect(noEmDash("I shipped fast — and well")).toBe("I shipped fast, and well");
    expect(noEmDash("a—b")).toBe("a, b");
    expect(noEmDash("no dashes here")).toBe("no dashes here");
  });
});

describe("cover length gate (issue #151 / D2) — the word-count check in code", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

  it("wordCount counts whitespace-separated words, collapsing runs of spaces", () => {
    expect(wordCount("one two three")).toBe(3);
    expect(wordCount("  extra   spaces  ")).toBe(2);
    expect(wordCount("")).toBe(0);
  });

  it("COVER_MIN_WORDS and COVER_MAX_WORDS are 120 and 180, the engine's own range", () => {
    expect(COVER_MIN_WORDS).toBe(120);
    expect(COVER_MAX_WORDS).toBe(180);
  });

  it("coverBodyWordCount sums p1+p2+p3 only — greeting and sign don't count", () => {
    expect(coverBodyWordCount({ p1: words(10), p2: words(10), p3: words(10) })).toBe(30);
  });

  it("isCoverLengthOk is true only inside the 120-180 range, inclusive at both ends", () => {
    expect(isCoverLengthOk({ p1: words(40), p2: words(40), p3: words(40) })).toBe(true); // 120
    expect(isCoverLengthOk({ p1: words(60), p2: words(60), p3: words(60) })).toBe(true); // 180
    expect(isCoverLengthOk({ p1: words(30), p2: words(30), p3: words(30) })).toBe(false); // 90, too short
    expect(isCoverLengthOk({ p1: words(70), p2: words(70), p3: words(70) })).toBe(false); // 210, too long
  });
});

describe("parseCoverJson — all five fields required, output ATS-cleaned (issue #151 / D2)", () => {
  const okJson = () => JSON.stringify({ greeting: "Hi,", p1: "one", p2: "two", p3: "three", sign: "Warmly, Jane" });

  it("parses a well-formed response", () => {
    expect(parseCoverJson(okJson())).toEqual({ greeting: "Hi,", p1: "one", p2: "two", p3: "three", sign: "Warmly, Jane" });
  });

  it("throws when any of the five fields is missing — the old check only looked at greeting/p1/sign, letting p2/p3 through empty", () => {
    for (const missing of ["greeting", "p1", "p2", "p3", "sign"]) {
      const obj = JSON.parse(okJson()) as Record<string, unknown>;
      delete obj[missing];
      expect(() => parseCoverJson(JSON.stringify(obj))).toThrow(missing);
    }
  });

  it("throws when a field is present but blank", () => {
    const obj = JSON.parse(okJson()) as Record<string, unknown>;
    obj.p2 = "   ";
    expect(() => parseCoverJson(JSON.stringify(obj))).toThrow("p2");
  });

  it("throws when the response has no JSON object at all", () => {
    expect(() => parseCoverJson("Sorry, I can't help with that.")).toThrow();
  });

  it("ATS-normalises smart quotes, en-dashes and ellipsis, on top of the em-dash guard", () => {
    const raw = JSON.stringify({
      greeting: "Hi—there,",
      p1: "I’ve shipped “fast” products…",
      p2: "two",
      p3: "three",
      sign: "Warmly, Jane",
    });
    const cover = parseCoverJson(raw);
    expect(cover.greeting).toBe("Hi, there,");
    expect(cover.p1).toBe('I\'ve shipped "fast" products...');
  });
});

describe("parseCommonPackJson — batched JSON parse (issue #151 / D4)", () => {
  const okJson = () =>
    JSON.stringify({ whyCompany: "one", whyFit: "two", productShipped: "three", measureSuccess: "four" });

  it("parses all four answers, keyed to COMMON_PACK_QUESTIONS", () => {
    expect(parseCommonPackJson(okJson())).toEqual({
      whyCompany: "one",
      whyFit: "two",
      productShipped: "three",
      measureSuccess: "four",
    });
  });

  it("throws when a field is missing", () => {
    const obj = JSON.parse(okJson()) as Record<string, unknown>;
    delete obj.productShipped;
    expect(() => parseCommonPackJson(JSON.stringify(obj))).toThrow("productShipped");
  });

  it("strips em-dashes from every answer", () => {
    const raw = JSON.stringify({ whyCompany: "fast — and well", whyFit: "b", productShipped: "c", measureSuccess: "d" });
    expect(parseCommonPackJson(raw).whyCompany).toBe("fast, and well");
  });
});

describe("tailorCover — one retry when the draft misses the word-count range (issue #151 / D2)", () => {
  const input = { role: "PM", company: "Acme", jdText: "", cvText: CV };
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
  const shortCover = () =>
    JSON.stringify({ greeting: "Hi,", p1: words(10), p2: words(10), p3: words(10), sign: "Warmly, John Doe" }); // 30 words
  const okCover = () =>
    JSON.stringify({ greeting: "Hi,", p1: words(40), p2: words(40), p3: words(40), sign: "Warmly, John Doe" }); // 120 words

  beforeEach(() => {
    callProxyMock.mockReset();
  });

  it("accepts the first draft when it already lands in range, with no retry call", async () => {
    callProxyMock.mockResolvedValue(okCover());
    const cover = await tailorCover(input, "John Doe");
    expect(coverBodyWordCount(cover)).toBe(120);
    expect(callProxyMock).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once when the first draft is outside 120-180 words, carrying the miss in the retry prompt", async () => {
    callProxyMock.mockResolvedValueOnce(shortCover()).mockResolvedValueOnce(shortCover());
    const cover = await tailorCover(input, "John Doe");
    expect(callProxyMock).toHaveBeenCalledTimes(2);
    const retryMessages = callProxyMock.mock.calls[1][0] as { content: string }[];
    expect(retryMessages[0].content).toContain("Your previous draft was 30 words");
    // Accepted even though the retry ALSO missed the range — one retry, never a loop.
    expect(coverBodyWordCount(cover)).toBe(30);
  });

  it("a second draft that lands in range is accepted normally", async () => {
    callProxyMock.mockResolvedValueOnce(shortCover()).mockResolvedValueOnce(okCover());
    const cover = await tailorCover(input, "John Doe");
    expect(callProxyMock).toHaveBeenCalledTimes(2);
    expect(coverBodyWordCount(cover)).toBe(120);
  });
});

describe("answerCommonPack — one call, four answers (issue #151 / D4)", () => {
  beforeEach(() => {
    callProxyMock.mockReset();
  });

  it("returns the four answers keyed to COMMON_PACK_QUESTIONS from a single call", async () => {
    callProxyMock.mockResolvedValue(
      JSON.stringify({ whyCompany: "a", whyFit: "b", productShipped: "c", measureSuccess: "d" }),
    );
    const pack = await answerCommonPack({ role: "PM", company: "Acme", jdText: "", cvText: CV });
    expect(pack).toEqual({ whyCompany: "a", whyFit: "b", productShipped: "c", measureSuccess: "d" });
    expect(callProxyMock).toHaveBeenCalledTimes(1);
  });
});

describe("stripLeadingSummary — conservative", () => {
  it("leaves CV unchanged when there is no leading summary heading", () => {
    expect(stripLeadingSummary(CV)).toBe(CV);
  });

  it("strips a clearly-labeled leading summary block, keeps the rest verbatim", () => {
    const withSummary = `Summary
Experienced PM who ships.

Professional Experience
Acme — PM — 2021
- did things`;
    const out = stripLeadingSummary(withSummary);
    expect(out).not.toContain("Experienced PM who ships.");
    expect(out).toContain("Professional Experience");
    expect(out).toContain("Acme — PM — 2021");
  });

  it("does not strip when the first line is not a summary heading", () => {
    const t = "Skills\nReact, TypeScript\n\nExperience\n- built things";
    expect(stripLeadingSummary(t)).toBe(t);
  });
});
