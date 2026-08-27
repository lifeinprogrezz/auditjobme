// src/lib/tailor.ts — the ONLY LLM surface for the apply bundle's CV + cover letter
// + drafted answers. The LLM writes ONLY (1) the tailored Professional Summary,
// (2) the cover letter, and (3) drafted answers to application-form questions. The
// CV BODY is never touched by an LLM — it is rendered verbatim from the user's
// cv_text in cvHtml.ts / cvStructured.ts. That is the trust rule.
//
// The transport (callProxy, HAIKU) lives in proxy.ts so it can be mocked in tests
// without a real network call or Supabase session; re-exported here for the
// existing call sites (cvParse.ts, Apply.tsx) that import them from "./tailor".
import { callProxy, HAIKU, type ProxyMessage } from "./proxy";
import { normalizeForAts } from "./cvStructured";

export { callProxy, HAIKU };
export type { ProxyMessage };

export type TailorInput = {
  role: string;
  company: string;
  jdText?: string | null;
  cvText: string;
  /** Optional per-role note from the candidate (why this company, a referral, a
   *  hook) — issue #76. Feeds the prompt ONLY when non-empty; the model may use
   *  it, never invent beyond it. Lives on the artifact row, never the profile. */
  context?: string | null;
};

export type CoverJson = { greeting: string; p1: string; p2: string; p3: string; sign: string };

/** Belt-and-suspenders no-em-dash guardrail on LLM output (the prompt also forbids them). */
export function noEmDash(s: string): string {
  return (s || "").replace(/\s*—\s*/g, ", ").replace(/—/g, ", ");
}

/** Cover-letter output guardrail (issue #151 / D2): the brand no-em-dash rule,
 *  then the same applicant-tracking-system normalisation the structured CV uses
 *  (smart quotes, en-dashes, ellipsis, zero-width chars) — so a pasted cover
 *  letter is as ATS-safe as the CV it travels with. */
function atsClean(s: string): string {
  return normalizeForAts(noEmDash(s || "")).trim();
}

// ── Pure prompt builders (unit-tested) ───────────────────────────────────────

/** Optional per-role note block (issue #76). Returns "" when there is nothing
 *  supplied, so every prompt that splices this in stays byte-identical to
 *  today when the box is empty — the no-context invariant, pinned in
 *  tailor.test.ts. When present, it explicitly bounds the model to the
 *  supplied facts (plus the CV) — never inventing beyond either. */
function buildContextBlock(context?: string | null): string {
  const c = (context || "").trim();
  if (!c) return "";
  return `\nWHAT THE CANDIDATE TOLD US ABOUT THIS APPLICATION (optional, from them directly): ${c}\nYou may use this if relevant. Do NOT invent anything beyond what is stated here or in the CV.\n`;
}

export function buildSummaryPrompt({ role, company, jdText, cvText, context }: TailorInput): string {
  const jd = (jdText || "").slice(0, 2500);
  const contextBlock = buildContextBlock(context);
  return `You are writing the Professional Summary for ONE specific job application — the only part of the CV that changes per role. Make it concrete to THIS role; it should be impossible to reuse verbatim for a different job.

Write a summary that:
- Leads with the angle THIS role cares about most, citing the 2-3 SPECIFIC achievements from the CV that best fit it (real employers, real numbers). Pick ONLY what genuinely fits the role.
- Draws a clear line from the candidate's real, stated experience to what this role does.

HARD RULES — do not break (this protects the candidate's credibility):
- Use ONLY facts, responsibilities, and numbers that literally appear in the CV below. Do NOT invent or imply responsibilities the CV does not state.
- Do NOT re-label or re-attribute any number. Keep every number's exact meaning and wording from the CV.
- No fabrication of any kind. When unsure, stay closer to the CV's own wording.
- Write in the FIRST PERSON ("I", or implied first person with no pronoun). NEVER refer to the candidate in the third person.
- 3 to 5 sentences (about 80-120 words). Specific, substantive, tight. No buzzwords, no boilerplate that could describe any candidate.
- Warm, honest. NO em-dashes at all (use commas or short sentences). Write in English.
- You may bold 2-4 key figures with ** **.

NEVER REFUSE, NEVER ADVISE (this text is printed straight onto the candidate's CV):
- If the role is a weak or partial fit, still write the summary. Lead with the closest real experience and say plainly what the person has done. A summary can be honest about a background without arguing for or against the fit.
- Do NOT judge the candidate, do NOT recommend a different role, do NOT explain what you can or cannot write, do NOT address the reader, do NOT mention the CV, the job description or yourself.

OUTPUT: the summary paragraph ONLY. No preamble, no analysis, no heading, no separators. Just the paragraph.

ROLE: ${role} at ${company}

JOB DESCRIPTION:
${jd || "(No JD text — write from the role title and company plus the CV; stay concrete, avoid filler.)"}
${contextBlock}
CANDIDATE CV (canonical facts; select the most relevant real proof from anywhere in it):
${cvText.slice(0, 6000)}

Professional Summary:`;
}

/** The cover letter prompt (issue #151 / D2: ported verbatim from the personal
 *  engine's buildCoverBody — career-ops lib/tailor-cv.mjs — plus the two
 *  guardrails that engine keeps in its summary prompt but had never carried
 *  into its cover prompt: the number re-attribution guard, and never stating
 *  relocation, a visa, or a dated availability beyond what the CV or the
 *  candidate's own note actually says. `retryWordCount`, when set, appends the
 *  one length-retry hint (tailorCover below fires it at most once). */
export function buildCoverPrompt(
  { role, company, jdText, cvText, context }: TailorInput,
  candidateName: string,
  retryWordCount?: number,
  flagUnbackedAvailability?: boolean,
): string {
  const contextBlock = buildContextBlock(context);
  const retryBlock = retryWordCount
    ? `\nYour previous draft was ${retryWordCount} words across the three body paragraphs. Rewrite it to land strictly between 120 and 180 words total across p1, p2 and p3 combined, keeping every fact exactly as it was.\n`
    : "";
  // issue #151 fix round 1, blocker 4: rule 3 below was prompt-only — nothing
  // ever checked the output against it. coverStatesUnbackedFacts catches a miss
  // and this retry block names it explicitly so the one retry the letter gets
  // (tailorCover) can actually fix it, not just re-roll blind.
  const unbackedBlock = flagUnbackedAvailability
    ? `\nYour previous draft stated relocation, a visa, sponsorship, or a dated availability that does not appear verbatim in the CV or in what the candidate told us. Rewrite it to remove that statement entirely, unless it appears verbatim in the CV or candidate context below.\n`
    : "";
  return `You are writing a cover letter for a job application. Produce a warm, honest cover letter body.

STRICT RULES:
1. Every metric/claim MUST come from the CV below. Do NOT invent numbers or responsibilities.
2. Do NOT re-label or re-attribute any number. Keep every number's exact meaning and wording from the CV.
3. Never state relocation, a visa, or a dated availability. Only mention any of these if it appears verbatim in the CV or in what the candidate told us below — otherwise leave it out entirely.
4. Write entirely in English. Warm, honest register (greeting like "Hi,").
5. NO em-dashes. Use commas or short sentences instead.
6. Total body length: 120-180 words across exactly 3 paragraphs.
7. Be honest about any gap vs the JD (1 sentence max).
8. First person. The sign-off line ends with the candidate's name: ${candidateName || "the candidate"}.
9. Return ONLY valid JSON with keys: greeting, p1, p2, p3, sign. No extra keys. greeting and sign are single lines; p1/p2/p3 are paragraph strings.

ROLE: ${role} at ${company}
JD EXCERPT: ${(jdText || "").slice(0, 800)}
${contextBlock}${retryBlock}${unbackedBlock}
CV TEXT (key facts):
${cvText.slice(0, 4500)}

Return JSON now:`;
}

/** Application-form question cap per role — bounds the sponsored-compute surface.
 *  Raised 8 -> 12 (issue #151): the common pack below spends 4 of these in one
 *  click, and the manual "paste one question" flow (Step 4) keeps its full 8
 *  after it, rather than losing half its room to the new feature. */
export const MAX_ANSWERS = 12;

export function buildAnswerPrompt({ role, company, jdText, cvText, context }: TailorInput, question: string): string {
  const jd = (jdText || "").slice(0, 2000);
  const contextBlock = buildContextBlock(context);
  return `You are answering ONE question from a job-application form, in the candidate's own voice.

QUESTION FROM THE FORM:
${question.slice(0, 500)}

HARD RULES — do not break (this protects the candidate's credibility):
- Use ONLY facts, responsibilities, and numbers that literally appear in the CV below. Do NOT invent projects, duties, tools, or numbers the CV does not state.
- If the CV genuinely has no material for the question, say so honestly in one short line and pivot to the closest real experience. Never fabricate an example.
- Be honest about any gap vs what the question implies (1 sentence max).
- Write in the FIRST PERSON. Warm, direct, like the candidate talking. Use contractions.
- NO em-dashes at all (use commas or short sentences). Write in English.
- 120-180 words maximum. If the question clearly asks for something very short (a yes/no, a number, a link), answer in 1-2 sentences instead.
- No buzzwords, no boilerplate that could describe any candidate.

OUTPUT: the answer ONLY. No preamble, no analysis, no heading. Just the answer text, ready to paste into the form.

ROLE: ${role} at ${company}

JOB DESCRIPTION (context for what they care about):
${jd || "(No JD text — answer from the role title and company plus the CV.)"}
${contextBlock}
CANDIDATE CV (canonical facts; the only permitted source of claims):
${cvText.slice(0, 6000)}

Answer:`;
}

/** The four questions almost every application asks (career-ops apply-sheet.mjs
 *  COMMON_FIELDS, the narrative half) — issue #151 / D4, the one-click "Answer
 *  the usual four". `key` is the JSON contract with the model; `label` is what
 *  the UI shows above each drafted answer. */
export const COMMON_PACK_QUESTIONS: { key: keyof CommonPackJson; label: string }[] = [
  { key: "whyCompany", label: "Why do you want to work at this company, and why this role?" },
  { key: "whyFit", label: "Why are you a strong fit for this role?" },
  { key: "productShipped", label: "Tell us about a product you've shipped that you're proud of." },
  { key: "measureSuccess", label: "How do you measure product success?" },
];

export type CommonPackJson = {
  whyCompany: string;
  whyFit: string;
  productShipped: string;
  measureSuccess: string;
};

export function buildCommonPackPrompt({ role, company, jdText, cvText, context }: TailorInput): string {
  const jd = (jdText || "").slice(0, 2000);
  const contextBlock = buildContextBlock(context);
  const questionsBlock = COMMON_PACK_QUESTIONS.map((q, i) => `${i + 1}. ${q.label}`).join("\n");
  return `You are answering four of the questions almost every job-application form asks, in the candidate's own voice, in ONE pass.

QUESTIONS:
${questionsBlock}

HARD RULES — do not break (this protects the candidate's credibility):
- Use ONLY facts, responsibilities, and numbers that literally appear in the CV below. Do NOT invent projects, duties, tools, or numbers the CV does not state.
- Do NOT re-label or re-attribute any number. Keep every number's exact meaning and wording from the CV.
- Write in the FIRST PERSON. Warm, direct, like the candidate talking. Use contractions.
- NO em-dashes at all (use commas or short sentences). Write in English.
- Each answer: 120-180 words.
- No buzzwords, no boilerplate that could describe any candidate.

ROLE: ${role} at ${company}

JOB DESCRIPTION (context for what they care about):
${jd || "(No JD text — answer from the role title and company plus the CV.)"}
${contextBlock}
CANDIDATE CV (canonical facts; the only permitted source of claims):
${cvText.slice(0, 6000)}

Return ONLY valid JSON with exactly these keys, one answer per question in order, no extra keys, no markdown fence, no preamble: whyCompany, whyFit, productShipped, measureSuccess.

Return JSON now:`;
}

// ── Cover letter length gate (issue #151 / D2) ───────────────────────────────

export const COVER_MIN_WORDS = 120;
export const COVER_MAX_WORDS = 180;

/** Plain whitespace word count — the same measure the engine's own rule uses
 *  ("120-180 words"), not a token count. */
export function wordCount(text: string): number {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

/** Word count across the three body paragraphs — greeting and sign-off don't count. */
export function coverBodyWordCount({ p1, p2, p3 }: Pick<CoverJson, "p1" | "p2" | "p3">): number {
  return wordCount(p1) + wordCount(p2) + wordCount(p3);
}

export function isCoverLengthOk(cover: Pick<CoverJson, "p1" | "p2" | "p3">): boolean {
  const n = coverBodyWordCount(cover);
  return n >= COVER_MIN_WORDS && n <= COVER_MAX_WORDS;
}

// ── Relocation / availability guard (issue #151 fix round 1, blocker 4) ─────
//
// buildCoverPrompt's rule 3 tells the model never to state relocation, a visa,
// or a dated availability unless it appears verbatim in the CV or the
// candidate's own note — but nothing ever checked the output against it.
// This is the code-side check: it never blocks generation itself, it only
// tells tailorCover's existing single retry slot when to fire.
const AVAILABILITY_RE = /relocat\w*|\bvisa\b|\bsponsorship\b|available from|start(?:ing)? on/i;

/** True when the cover letter's body states relocation/visa/sponsorship/dated
 *  availability language that is NOT backed by the CV or the candidate's own
 *  context — i.e. the model invented it. */
export function coverStatesUnbackedFacts(
  cover: Pick<CoverJson, "p1" | "p2" | "p3">,
  cvText: string,
  context?: string | null,
): boolean {
  const body = `${cover.p1} ${cover.p2} ${cover.p3}`;
  if (!AVAILABILITY_RE.test(body)) return false;
  const backing = `${cvText || ""} ${context || ""}`;
  return !AVAILABILITY_RE.test(backing);
}

// ── JSON parsing + validation (pure, unit-tested) ────────────────────────────

function firstJsonObject(raw: string): Record<string, unknown> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Model did not return JSON");
  return JSON.parse(match[0]) as Record<string, unknown>;
}

/** Parses + validates the cover letter JSON: all five fields present and
 *  non-blank (issue #151 — the old check let p2/p3 through empty), then
 *  ATS-cleans every field. */
export function parseCoverJson(raw: string): CoverJson {
  const parsed = firstJsonObject(raw);
  const fields = ["greeting", "p1", "p2", "p3", "sign"] as const;
  for (const key of fields) {
    const value = parsed[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`Cover letter JSON missing field: ${key}`);
  }
  return {
    greeting: atsClean(parsed.greeting as string),
    p1: atsClean(parsed.p1 as string),
    p2: atsClean(parsed.p2 as string),
    p3: atsClean(parsed.p3 as string),
    sign: atsClean(parsed.sign as string),
  };
}

/** Parses + validates the common-pack JSON: all four answers present. */
export function parseCommonPackJson(raw: string): CommonPackJson {
  const parsed = firstJsonObject(raw);
  const out = {} as CommonPackJson;
  for (const { key } of COMMON_PACK_QUESTIONS) {
    const value = parsed[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`Common pack JSON missing field: ${key}`);
    out[key] = noEmDash(value);
  }
  return out;
}

// ── LLM calls ─────────────────────────────────────────────────────────────────

/** Phrases that mean the model answered the OPERATOR instead of writing the CV
 *  line: a refusal, a recommendation, a critique of the fit, or anything that
 *  talks about "the candidate" or "the CV". Lowercase, matched as substrings. */
const SUMMARY_META_MARKERS = [
  "i cannot",
  "i can't",
  "i can not",
  "i need to be direct",
  "i must be direct",
  "unable to write",
  "without fabricating",
  "would require me to",
  "my recommendation",
  "i recommend",
  "would you like me to",
  "the cv shows",
  "this candidate",
  "the candidate's",
  "the candidate is",
  "as an ai",
  "language model",
  "does not align",
  "is not a fit",
  "poor fit for",
  "before reapplying",
];

/**
 * Is this text actually a Professional Summary, or is it the model talking to us?
 *
 * 2026-08-27: a real download carried the model's refusal ("I need to be direct:
 * this candidate's professional background does not align ... I cannot ethically
 * write this summary ... Would you like me to help write a summary for a different
 * role?") printed under PROFESSIONAL SUMMARY on the candidate's own CV. Nothing
 * checked what came back. A summary is first person and short; anything that
 * refuses, advises, or discusses the candidate in the third person is not one.
 */
export function isUsableSummary(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (t.length < 40) return false;
  const lower = t.toLowerCase();
  if (SUMMARY_META_MARKERS.some((m) => lower.includes(m))) return false;
  // A summary is written as the person. Accept "I ", "I'm", "I've", "My ".
  if (!/(^|\s)(i|i'm|i've|my)(\s|')/i.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words > 220) return false; // 80-120 asked for; a lecture is not a summary
  return true;
}

/**
 * The tailored summary, or the candidate's own summary when the model does not
 * produce one. One retry with an explicit correction, then the fallback — the CV
 * always prints a real summary, never model prose about the candidate.
 * `fallbackSummary` is the person's own stored summary (cv_structured.summary).
 */
export async function tailorSummary(input: TailorInput, fallbackSummary?: string | null): Promise<string> {
  const first = noEmDash(await callProxy([{ role: "user", content: buildSummaryPrompt(input) }], 500, "cv"));
  if (isUsableSummary(first)) return first;

  const corrective = `${buildSummaryPrompt(input)}

Your previous answer was not a summary: it discussed the candidate or declined the task. Write ONLY the first-person Professional Summary paragraph now, using the candidate's real experience, whatever the fit.`;
  const second = noEmDash(await callProxy([{ role: "user", content: corrective }], 500, "cv"));
  if (isUsableSummary(second)) return second;

  const fallback = (fallbackSummary ?? "").trim();
  return fallback.length > 0 ? noEmDash(fallback) : "";
}

export async function answerQuestion(input: TailorInput, question: string): Promise<string> {
  const text = await callProxy([{ role: "user", content: buildAnswerPrompt(input, question) }], 400, "answer");
  return noEmDash(text);
}

/** One retry when the draft lands outside 120-180 words (issue #151 / D2) OR
 *  states an unbacked relocation/visa/availability claim (issue #151 fix round
 *  1, blocker 4), then accepts whatever comes back — never loops. Both checks
 *  share the same single retry slot, so this still ever calls the model at
 *  most twice. The prompt itself already asks for both; the retry only fires
 *  when the model missed one. */
export async function tailorCover(input: TailorInput, candidateName: string): Promise<CoverJson> {
  const first = parseCoverJson(await callProxy([{ role: "user", content: buildCoverPrompt(input, candidateName) }], 800, "letter"));
  const lengthOk = isCoverLengthOk(first);
  const unbacked = coverStatesUnbackedFacts(first, input.cvText, input.context);
  if (lengthOk && !unbacked) return first;
  const retryPrompt = buildCoverPrompt(input, candidateName, lengthOk ? undefined : coverBodyWordCount(first), unbacked);
  return parseCoverJson(await callProxy([{ role: "user", content: retryPrompt }], 800, "letter"));
}

/** The four common-pack answers in ONE call (issue #151 / D4) — counts as 4
 *  toward MAX_ANSWERS, same as four calls to answerQuestion would. */
export async function answerCommonPack(input: TailorInput): Promise<CommonPackJson> {
  const raw = await callProxy([{ role: "user", content: buildCommonPackPrompt(input) }], 1600, "answer");
  return parseCommonPackJson(raw);
}
