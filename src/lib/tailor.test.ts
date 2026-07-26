import { describe, it, expect } from "vitest";
import { buildSummaryPrompt, buildCoverPrompt, buildAnswerPrompt, noEmDash, MAX_ANSWERS } from "./tailor";
import { stripLeadingSummary, buildCvHtml, buildCoverHtml, esc } from "./cvHtml";

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

  it("cover prompt requests JSON, forbids em-dashes, and signs with the candidate name", () => {
    const p = buildCoverPrompt({ role: "PM", company: "Acme", jdText: "", cvText: CV }, "John Doe");
    expect(p).toContain("greeting, p1, p2, p3, sign");
    expect(p).toContain("NO em-dashes");
    expect(p).toContain("John Doe");
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

  it("answer cap is bounded", () => {
    expect(MAX_ANSWERS).toBeLessThanOrEqual(10);
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

  it("passthrough — supplied context reaches all three prompts, with the use-not-invent guardrail (issue #76)", () => {
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
    for (const p of [summaryPrompt, coverPrompt, answerPrompt]) {
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

describe("CV trust rule — verbatim body", () => {
  it("renders the cv_text body VERBATIM (escaped) inside the CV HTML", () => {
    const summary = "Tailored summary for the role.";
    const html = buildCvHtml({ name: "John Doe", summary, cvText: CV });
    // the exact CV text (escaped) must appear unchanged — no reorder, no rewrite
    expect(html).toContain(esc(stripLeadingSummary(CV)));
    expect(html).toContain(summary);
    expect(html).toContain("Grew activation 40%");
  });

  it("escapes HTML in the body (no injection)", () => {
    const html = buildCvHtml({ name: "X", summary: "s", cvText: "Skills: <script>alert(1)</script>" });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
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

describe("cover HTML", () => {
  it("renders all five cover parts, escaped", () => {
    const cover = { greeting: "Hi,", p1: "para one", p2: "para two", p3: "para three", sign: "Best, John" };
    const html = buildCoverHtml({ name: "John Doe", company: "Acme", cover });
    expect(html).toContain("para one");
    expect(html).toContain("para three");
    expect(html).toContain("Best, John");
    expect(html).toContain("Acme");
  });
});
