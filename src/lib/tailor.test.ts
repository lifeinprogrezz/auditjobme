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
  coverStatesUnbackedFacts,
  parseCoverJson,
  parseCommonPackJson,
  tailorCover,
  tailorSummary,
  fixCompanyCasing,
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

  it("cover prompt appends the unbacked-availability hint only when flagged (issue #151 fix round 1, blocker 4)", () => {
    const base = buildCoverPrompt({ role: "PM", company: "Acme", jdText: "", cvText: CV }, "John Doe");
    const retry = buildCoverPrompt({ role: "PM", company: "Acme", jdText: "", cvText: CV }, "John Doe", undefined, true);
    expect(base).not.toContain("stated relocation, a visa, sponsorship");
    expect(retry).toContain("stated relocation, a visa, sponsorship, or a dated availability");
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
      "You are writing the Professional Summary for ONE specific job application — the only part of the CV that changes per role. Make it concrete to THIS role; it should be impossible to reuse verbatim for a different job.\n\nWrite a summary that:\n- Leads with the angle THIS role cares about most, citing the 2-3 SPECIFIC achievements from the CV that best fit it (real employers, real numbers). Pick ONLY what genuinely fits the role.\n- Draws a clear line from the candidate's real, stated experience to what this role does.\n\nHARD RULES — do not break (this protects the candidate's credibility):\n- Use ONLY facts, responsibilities, and numbers that literally appear in the CV below. Do NOT invent or imply responsibilities the CV does not state.\n- Do NOT re-label or re-attribute any number. Keep every number's exact meaning and wording from the CV.\n- Spell every company name exactly as the CV spells it, capital for capital (if the CV writes GLIQUID, write GLIQUID).\n- No fabrication of any kind. When unsure, stay closer to the CV's own wording.\n- Write in the FIRST PERSON (\"I\", or implied first person with no pronoun). NEVER refer to the candidate in the third person.\n- 3 to 5 sentences (about 80-120 words). Specific, substantive, tight. No buzzwords, no boilerplate that could describe any candidate.\n- Warm, honest. NO em-dashes at all (use commas or short sentences). Write in English.\n- You may bold 2-4 key figures with ** **.\n\nNEVER REFUSE, NEVER ADVISE (this text is printed straight onto the candidate's CV):\n- If the role is a weak or partial fit, still write the summary. Lead with the closest real experience and say plainly what the person has done. A summary can be honest about a background without arguing for or against the fit.\n- Do NOT judge the candidate, do NOT recommend a different role, do NOT explain what you can or cannot write, do NOT address the reader, do NOT mention the CV, the job description or yourself.\n\nOUTPUT: the summary paragraph ONLY. No preamble, no analysis, no heading, no separators. Just the paragraph.\n\nROLE: Senior PM at Acme\n\nJOB DESCRIPTION:\nOwn the roadmap\n\nCANDIDATE CV (canonical facts; select the most relevant real proof from anywhere in it):\nJohn Doe\njohn@example.com\n\nProfessional Experience\n\nAcme Corp — Product Manager — 2021-2024\n- Grew activation 40% by shipping onboarding redesign\n- Led a team of 5\n\nEducation\nBSc Computer Science, MIT\n\nProfessional Summary:",
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

describe("coverStatesUnbackedFacts — the relocation/availability guard (issue #151 fix round 1, blocker 4)", () => {
  const cover = (p1: string) => ({ p1, p2: "Some other paragraph.", p3: "A closing paragraph." });

  it("false when the cover never mentions relocation, a visa, sponsorship, or a dated availability", () => {
    expect(coverStatesUnbackedFacts(cover("I led a team of five and grew activation 40%."), CV)).toBe(false);
  });

  it("true when the cover states relocation and neither the CV nor the context backs it up", () => {
    expect(coverStatesUnbackedFacts(cover("I'm relocating to Austria for this role."), CV)).toBe(true);
  });

  it("false when the CV itself says relocation, visa, or availability — the JD-side rule stays: only invented claims are flagged", () => {
    const cvWithVisa = `${CV}\n\nAlready holds a valid visa for Austria.`;
    expect(coverStatesUnbackedFacts(cover("I'm relocating to Austria for this role."), cvWithVisa)).toBe(false);
  });

  it("false when the candidate's own context backs the claim", () => {
    expect(coverStatesUnbackedFacts(cover("I'm available from next month."), CV, "I'm available from next month")).toBe(false);
  });

  it("catches visa and sponsorship wording too, not just \"relocat\"", () => {
    expect(coverStatesUnbackedFacts(cover("I would need visa sponsorship for this role."), CV)).toBe(true);
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

  // issue #151 fix round 1, blocker 4: a fixture letter that states relocation
  // must trigger the same single retry slot the word-count check uses.
  it("retries exactly once when the first draft states unbacked relocation, carrying the hint in the retry prompt", async () => {
    const relocatingCover = () =>
      JSON.stringify({
        greeting: "Hi,",
        p1: `I'm relocating to Austria for this role. ${words(35)}`,
        p2: words(40),
        p3: words(40),
        sign: "Warmly, John Doe",
      }); // 120+ words, in range — only the relocation claim should trip the retry
    callProxyMock.mockResolvedValueOnce(relocatingCover()).mockResolvedValueOnce(okCover());
    const cover = await tailorCover(input, "John Doe");
    expect(callProxyMock).toHaveBeenCalledTimes(2);
    const retryMessages = callProxyMock.mock.calls[1][0] as { content: string }[];
    expect(retryMessages[0].content).toContain("stated relocation, a visa, sponsorship, or a dated availability");
    // Retry didn't ALSO carry a word-count hint — the first draft was in range.
    expect(retryMessages[0].content).not.toContain("Your previous draft was");
    expect(coverBodyWordCount(cover)).toBe(120);
  });

  it("never fires the retry when relocation is backed by the CV or the candidate's own context", async () => {
    callProxyMock.mockResolvedValue(
      JSON.stringify({ greeting: "Hi,", p1: `I'm relocating to Austria for this role. ${words(35)}`, p2: words(40), p3: words(40), sign: "Warmly, John Doe" }),
    );
    await tailorCover({ ...input, context: "I'm relocating to Austria" }, "John Doe");
    expect(callProxyMock).toHaveBeenCalledTimes(1);
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

// The CV body prints GLIQUID, because that is how his CV writes it. The summary is
// the one model-written line, and a real download came back saying "Gliquid" on top
// of a body saying "GLIQUID": one page, two spellings of his own company. A prompt
// rule cannot be tested, so the correction is in code.
describe("fixCompanyCasing — the summary spells a company the way the CV does", () => {
  const COMPANIES = ["GLIQUID", "Tierra Labs Ltd", "Equilibre Labs"];

  it("puts the CV's capitals back on a name the model re-cased", () => {
    const summary = "I shipped $375M in trading volume at Gliquid and $330K at equilibre labs.";
    expect(fixCompanyCasing(summary, COMPANIES)).toBe(
      "I shipped $375M in trading volume at GLIQUID and $330K at Equilibre Labs.",
    );
  });

  it("changes nothing but the letters' case: same length, same words, same punctuation", () => {
    const summary = "At gliquid, I led 4 people; at TIERRA LABS LTD I raised $150,000 (a grant).";
    const fixed = fixCompanyCasing(summary, COMPANIES);
    expect(fixed).toHaveLength(summary.length);
    expect(fixed.toLowerCase()).toBe(summary.toLowerCase());
    expect(fixed).toBe("At GLIQUID, I led 4 people; at Tierra Labs Ltd I raised $150,000 (a grant).");
  });

  it("only ever replaces a WHOLE word: a word that merely contains the name is left alone", () => {
    const summary = "Gliquidate is a verb, gliquid-like is a hyphenation, and liquid is a liquid.";
    // "gliquid-like" IS a whole match followed by a hyphen, which is not a letter:
    // the name ends there. "Gliquidate" and "liquid" are not the name at all.
    expect(fixCompanyCasing(summary, COMPANIES)).toBe(
      "Gliquidate is a verb, GLIQUID-like is a hyphenation, and liquid is a liquid.",
    );
  });

  it("handles the shapes a summary actually uses: possessive, bold markers, start of line", () => {
    expect(fixCompanyCasing("Gliquid's first release shipped in a week.", COMPANIES)).toBe(
      "GLIQUID's first release shipped in a week.",
    );
    expect(fixCompanyCasing("I ran **Gliquid** and **tierra labs ltd**.", COMPANIES)).toBe(
      "I ran **GLIQUID** and **Tierra Labs Ltd**.",
    );
    expect(fixCompanyCasing("gliquid gliquid gliquid", COMPANIES)).toBe("GLIQUID GLIQUID GLIQUID");
  });

  it("prefers the longer name when one company's name starts with another's", () => {
    expect(fixCompanyCasing("I was at tierra labs ltd.", ["Tierra Labs", "Tierra Labs Ltd"])).toBe(
      "I was at Tierra Labs Ltd.",
    );
  });

  it("leaves a name the CV itself spells two ways alone — there is no right answer to pick", () => {
    const summary = "I worked at gliquid twice.";
    expect(fixCompanyCasing(summary, ["GLIQUID", "Gliquid"])).toBe(summary);
  });

  it("treats a name's punctuation as literal text, never as a pattern", () => {
    // A regular expression built from these would match "AxB Inc" and blow up on "C++".
    expect(fixCompanyCasing("I was at a.b. inc and c++ labs.", ["A.B. Inc", "C++ Labs"])).toBe(
      "I was at A.B. Inc and C++ Labs.",
    );
    expect(fixCompanyCasing("I was at axb inc.", ["A.B. Inc"])).toBe("I was at axb inc.");
  });

  it("is a no-op with nothing to do: right casing, no companies, empty strings, blank names", () => {
    const right = "I shipped $375M at GLIQUID.";
    expect(fixCompanyCasing(right, COMPANIES)).toBe(right);
    expect(fixCompanyCasing(right, [])).toBe(right);
    expect(fixCompanyCasing(right, ["", "   "])).toBe(right);
    expect(fixCompanyCasing("", COMPANIES)).toBe("");
  });
});

describe("tailorSummary — the casing correction runs on what the model wrote", () => {
  const input = { role: "PM", company: "Acme", jdText: "", cvText: CV };
  const COMPANIES = ["GLIQUID"];
  const modelSummary = (name: string) =>
    `I shipped a consumer exchange at ${name}, processing $375M in user trading volume, and I led a team of 4 people across product and engineering.`;

  beforeEach(() => {
    callProxyMock.mockReset();
  });

  it("corrects the company name in an accepted first draft", async () => {
    callProxyMock.mockResolvedValue(modelSummary("Gliquid"));
    expect(await tailorSummary(input, "my own summary", COMPANIES)).toBe(modelSummary("GLIQUID"));
    expect(callProxyMock).toHaveBeenCalledTimes(1);
  });

  it("corrects it in the retry draft too, when the first answer was not a summary", async () => {
    callProxyMock.mockResolvedValueOnce("I cannot write this summary.").mockResolvedValueOnce(modelSummary("gliquid"));
    expect(await tailorSummary(input, "my own summary", COMPANIES)).toBe(modelSummary("GLIQUID"));
    expect(callProxyMock).toHaveBeenCalledTimes(2);
  });

  it("leaves the person's OWN summary exactly as they wrote it — it is not model output", async () => {
    callProxyMock.mockResolvedValue("I cannot write this summary.");
    const own = "I spell my own company Gliquid, thanks.";
    expect(await tailorSummary(input, own, COMPANIES)).toBe(own);
  });

  it("still works when no company list is passed at all", async () => {
    callProxyMock.mockResolvedValue(modelSummary("Gliquid"));
    expect(await tailorSummary(input, "my own summary")).toBe(modelSummary("Gliquid"));
  });

  it("asks the model for the CV's own capitalisation as well, so the fix rarely has to fire", () => {
    expect(buildSummaryPrompt(input)).toContain("Spell every company name exactly as the CV spells it");
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
