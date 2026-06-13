import { supabase } from "@/integrations/supabase/client";

export interface ScoreableProfile {
  target_seniority: string | null;
  target_cities: string[] | null;
  open_to_remote: boolean | null;
  citizenship: string | null;
  eu_work_authorized: boolean | null;
  languages: string[] | null;
  cv_text: string | null;
}

export interface ScoreableJob {
  id: string;
  company: string;
  title: string;
  location: string | null;
  remote: boolean;
  seniority: string | null;
  jd_text: string | null;
}

export const RUBRIC_VERSION = "v1";

const SYSTEM = `You score how strong a match a Product Manager role is for a specific job-seeker, on a 0 to 5 scale (one decimal). 5 means an excellent fit they should prioritize; 0 means a poor fit or one they realistically can't get. Weigh, in roughly this order: seniority match (their target level vs the role's), geography and accessibility (is it in a target city, or remote if they're open to remote), work authorization (their citizenship and EU authorization vs where the role is), language fit, and how well their CV and background match the role. Return ONLY a JSON object, no other text: {"score": <number 0-5>, "reason": "<one short plain-spoken sentence, no jargon, no em-dashes>"}.`;

/** Score a single job against a profile via the anthropic-proxy edge function. Returns null on any failure. */
export async function scoreJob(
  profile: ScoreableProfile,
  job: ScoreableJob,
): Promise<{ score: number; reason: string } | null> {
  const userMsg = [
    "JOB-SEEKER PROFILE",
    `- target level: ${profile.target_seniority ?? "unspecified"}`,
    `- target cities: ${(profile.target_cities ?? []).join(", ") || "none given"}`,
    `- open to remote: ${profile.open_to_remote ? "yes" : "no"}`,
    `- citizenship: ${profile.citizenship ?? "unspecified"}; EU work-authorized: ${profile.eu_work_authorized ? "yes" : "no or unknown"}`,
    `- languages: ${(profile.languages ?? []).join(", ") || "unspecified"}`,
    `- CV: ${(profile.cv_text ?? "").slice(0, 2000) || "not provided"}`,
    "",
    "ROLE",
    `- ${job.title} at ${job.company}`,
    `- location: ${job.location ?? "unknown"}${job.remote ? " (remote-friendly)" : ""}`,
    `- level: ${job.seniority ?? "unspecified"}`,
    `- description: ${(job.jd_text ?? "").slice(0, 3000) || "not available"}`,
  ].join("\n");

  const { data, error } = await supabase.functions.invoke("anthropic-proxy", {
    body: {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    },
  });
  if (error || !data) return null;

  const text: string = data?.content?.[0]?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const score = Math.max(0, Math.min(5, Number(parsed.score)));
    if (Number.isNaN(score)) return null;
    return { score, reason: String(parsed.reason ?? "") };
  } catch {
    return null;
  }
}
