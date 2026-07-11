// src/lib/tailor.ts — the ONLY LLM surface for the apply bundle's CV + cover letter.
//
// Generalized port of career-ops lib/tailor-cv.mjs: the LLM writes ONLY (1) the tailored
// Professional Summary and (2) the cover letter. The CV BODY is never touched by an LLM —
// it is rendered verbatim from the user's cv_text in cvHtml.ts. That is the trust rule.
//
// Both calls go through the anthropic-proxy edge function (our key, Haiku), authenticated
// with the user's session token. The proxy enforces the spend caps and meters usage
// server-side — the client just passes `kind` for attribution.
import { supabase } from "@/integrations/supabase/client";

export const HAIKU = "claude-haiku-4-5-20251001";

export type TailorInput = {
  role: string;
  company: string;
  jdText?: string | null;
  cvText: string;
};

export type CoverJson = { greeting: string; p1: string; p2: string; p3: string; sign: string };

type ProxyMessage = { role: "user" | "assistant"; content: string };

async function callProxy(messages: ProxyMessage[], maxTokens: number, kind: "cv" | "letter"): Promise<string> {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error("Not authenticated");
  const res = await fetch(`${url}/functions/v1/anthropic-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: key,
      "x-region": "eu-central-1", // residency pin: edge fns run caller-near by default (S1)
    },
    body: JSON.stringify({ messages, model: HAIKU, max_tokens: maxTokens, kind }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `anthropic-proxy ${res.status}`);
  }
  const data = await res.json();
  return ((data?.content as { type: string; text: string }[]) || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Belt-and-suspenders no-em-dash guardrail on LLM output (the prompt also forbids them). */
export function noEmDash(s: string): string {
  return (s || "").replace(/\s*—\s*/g, ", ").replace(/—/g, ", ");
}

// ── Pure prompt builders (unit-tested) ───────────────────────────────────────

export function buildSummaryPrompt({ role, company, jdText, cvText }: TailorInput): string {
  const jd = (jdText || "").slice(0, 2500);
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

OUTPUT: the summary paragraph ONLY. No preamble, no analysis, no heading, no separators. Just the paragraph.

ROLE: ${role} at ${company}

JOB DESCRIPTION:
${jd || "(No JD text — write from the role title and company plus the CV; stay concrete, avoid filler.)"}

CANDIDATE CV (canonical facts; select the most relevant real proof from anywhere in it):
${cvText.slice(0, 6000)}

Professional Summary:`;
}

export function buildCoverPrompt({ role, company, jdText, cvText }: TailorInput, candidateName: string): string {
  return `You are writing a cover letter for a job application. Produce a warm, honest cover letter body.

STRICT RULES:
1. Every metric/claim MUST come from the CV below. Do NOT invent numbers or responsibilities.
2. Write entirely in English. Warm, honest register (greeting like "Hi,").
3. NO em-dashes. Use commas or short sentences instead.
4. Total body length: 120-180 words across exactly 3 paragraphs.
5. Be honest about any gap vs the JD (1 sentence max).
6. First person. The sign-off line ends with the candidate's name: ${candidateName || "the candidate"}.
7. Return ONLY valid JSON with keys: greeting, p1, p2, p3, sign. No extra keys. greeting and sign are single lines; p1/p2/p3 are paragraph strings.

ROLE: ${role} at ${company}
JD EXCERPT: ${(jdText || "").slice(0, 800)}

CV TEXT (key facts):
${cvText.slice(0, 4500)}

Return JSON now:`;
}

// ── LLM calls ─────────────────────────────────────────────────────────────────

export async function tailorSummary(input: TailorInput): Promise<string> {
  const text = await callProxy([{ role: "user", content: buildSummaryPrompt(input) }], 500, "cv");
  return noEmDash(text);
}

export async function tailorCover(input: TailorInput, candidateName: string): Promise<CoverJson> {
  const raw = await callProxy([{ role: "user", content: buildCoverPrompt(input, candidateName) }], 800, "letter");
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Cover letter did not return JSON");
  const parsed = JSON.parse(match[0]) as CoverJson;
  if (!parsed.greeting || !parsed.p1 || !parsed.sign) throw new Error("Cover letter JSON missing fields");
  return {
    greeting: noEmDash(parsed.greeting),
    p1: noEmDash(parsed.p1),
    p2: noEmDash(parsed.p2),
    p3: noEmDash(parsed.p3),
    sign: noEmDash(parsed.sign),
  };
}
