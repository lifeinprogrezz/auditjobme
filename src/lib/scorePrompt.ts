// The scoring rubric + prompt shaping, extracted from score.ts so BOTH the
// in-session client scorer (score.ts) and the server-side nightly worker
// (api/nightly.ts) share one source of truth for the rubric. Pure — NO supabase
// client import — so it is safe to import from the Node worker. Rule + code move
// together: change the rubric here and both callers follow.
// Pinned by src/test/score.test.ts (parseScoreResponse).

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
  /** Grounding facts from jobs.extraction (Phase B, Rober 7-09): the scorer reads the
   *  cite-anchored fact instead of re-deriving it from prose. Optional — absent → the
   *  line is simply omitted from the prompt. */
  yoe_min?: number | null;
  geo_eligibility?: string | null;
}

// v2 (2026-07-06): added fit_bullets — 3-5 grounded "why you fit" points for the
// /roles detail panel. v3 (2026-07-09): ground the ROLE block on JD-extracted facts
// (yoe_min, geo_eligibility). Bumping the version re-scores cached rows lazily on next load.
export const RUBRIC_VERSION = "v3";

export const SYSTEM = `You score how strong a match a Product Manager role is for a specific job-seeker, on a 0 to 5 scale (one decimal). 5 means an excellent fit they should prioritize; 0 means a poor fit or one they realistically can't get. Weigh, in roughly this order: seniority match (their target level vs the role's), geography and accessibility (is it in a target city, or remote if they're open to remote), work authorization (their citizenship and EU authorization vs where the role is), language fit, and how well their CV and background match the role. Return ONLY a JSON object, no other text: {"score": <number 0-5>, "reason": "<one short plain-spoken sentence, no jargon, no em-dashes>", "fit_bullets": ["<3 to 5 short second-person bullets, each naming a SPECIFIC overlap between THIS person's CV/background and THIS role (e.g. 'Your marketplace growth work maps to their two-sided model'). Ground every bullet in their actual CV and the role; never generic filler; no jargon, no em-dashes. If their CV is weak for this role, say so honestly in fewer bullets.>"]}.`;

/** Build the user-turn message for one profile×job. Identical shaping for the
 *  live reveal and the nightly run so scores never diverge by caller. */
export function buildScoreUserMessage(profile: ScoreableProfile, job: ScoreableJob): string {
  return [
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
    ...(job.yoe_min != null ? [`- experience required (extracted from JD): ${job.yoe_min}+ years`] : []),
    ...(job.geo_eligibility ? [`- work eligibility (extracted from JD): ${job.geo_eligibility}`] : []),
    `- description: ${(job.jd_text ?? "").slice(0, 3000) || "not available"}`,
  ].join("\n");
}

/**
 * Pull the {score, reason, fit_bullets} out of the model's raw text and clamp it
 * to a sane range: grabs the first {...} block, coerces score into [0, 5], and
 * returns null on any missing-JSON / malformed / non-numeric response.
 */
export function parseScoreResponse(
  text: string,
): { score: number; reason: string; fitBullets: string[] } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const score = Math.max(0, Math.min(5, Number(parsed.score)));
    if (Number.isNaN(score)) return null;
    const fitBullets = Array.isArray(parsed.fit_bullets)
      ? parsed.fit_bullets
          .filter((b: unknown) => typeof b === "string" && b.trim())
          .map((b: string) => b.trim())
          .slice(0, 5)
      : [];
    return { score, reason: String(parsed.reason ?? ""), fitBullets };
  } catch {
    return null;
  }
}
