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
// (yoe_min, geo_eligibility). v4 (2026-07-11, Track D S2): explainable-score data
// contract — per-dimension subscores + cited evidence (verbatim CV line ↔ JD phrase,
// signed contribution), stored as additive keys in scores.signals; the score viz
// consumes them later. Bumping the version re-scores cached rows lazily on next load.
export const RUBRIC_VERSION = "v4";

/** The five rubric dimensions, in weighing order — subscores cover exactly these. */
export const SUBSCORE_KEYS = ["seniority", "geography", "work_auth", "language", "background"] as const;
export type SubscoreKey = (typeof SUBSCORE_KEYS)[number];

export interface ScoreSubscore {
  key: SubscoreKey;
  score: number; // 0-5, same scale as the blended score
}

export interface ScoreEvidence {
  label: string; // 2-4 word factor name, e.g. "Marketplace experience"
  cvLine: string; // verbatim CV quote ("" when nothing in the CV supports the factor)
  jdPhrase: string; // verbatim JD quote ("" likewise)
  contribution: number; // -1..1, negative = pulled the score down
}

/** One response budget for every caller — the v4 JSON (subscores + evidence) does not
 *  fit the old 500; a truncated response parses to null and the paid-for score is lost. */
export const SCORE_MAX_TOKENS = 1000;

export const SYSTEM = `You score how strong a match a Product Manager role is for a specific job-seeker, on a 0 to 5 scale (one decimal). 5 means an excellent fit they should prioritize; 0 means a poor fit or one they realistically can't get. Weigh, in roughly this order: seniority match (their target level vs the role's), geography and accessibility (is it in a target city, or remote if they're open to remote), work authorization (their citizenship and EU authorization vs where the role is), language fit, and how well their CV and background match the role. Return ONLY a JSON object, no other text: {"score": <number 0-5>, "reason": "<one short plain-spoken sentence, no jargon, no em-dashes>", "fit_bullets": ["<3 to 5 short second-person bullets, each naming a SPECIFIC overlap between THIS person's CV/background and THIS role (e.g. 'Your marketplace growth work maps to their two-sided model'). Ground every bullet in their actual CV and the role; never generic filler; no jargon, no em-dashes. If their CV is weak for this role, say so honestly in fewer bullets.>"], "subscores": [{"key": "seniority", "score": <0-5>}, {"key": "geography", "score": <0-5>}, {"key": "work_auth", "score": <0-5>}, {"key": "language", "score": <0-5>}, {"key": "background", "score": <0-5>}], "evidence": [<3 to 6 objects, each {"label": "<2-4 word factor name>", "cv_line": "<quote copied word-for-word from their CV, at most 12 words, or an empty string if nothing in the CV supports this factor>", "jd_phrase": "<quote copied word-for-word from the role description, at most 12 words, or an empty string>", "contribution": <-1 to 1, negative when this factor pulled the score DOWN>}. Cover the strongest pushes in BOTH directions. Quotes must be exact substrings of the CV or the description; never invent or paraphrase a quote, use an empty string instead.>]}.`;

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

export interface ParsedScore {
  score: number;
  reason: string;
  fitBullets: string[];
  /** v4 — [] on pre-v4 or malformed responses; a missing dimension is simply absent. */
  subscores: ScoreSubscore[];
  /** v4 — [] on pre-v4 or malformed responses. */
  evidence: ScoreEvidence[];
}

/**
 * Pull the {score, reason, fit_bullets, subscores, evidence} out of the model's raw
 * text and clamp it to a sane range: grabs the first {...} block, coerces score (and
 * each subscore) into [0, 5] and contribution into [-1, 1], drops malformed entries,
 * and returns null on any missing-JSON / malformed / non-numeric response. The v4
 * fields degrade to [] — a response without them still yields a usable score.
 */
export function parseScoreResponse(text: string): ParsedScore | null {
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
    const seen = new Set<string>();
    const subscores: ScoreSubscore[] = (Array.isArray(parsed.subscores) ? parsed.subscores : [])
      .filter(
        (s: unknown): s is { key: string; score: unknown } =>
          !!s &&
          typeof s === "object" &&
          (SUBSCORE_KEYS as readonly string[]).includes((s as { key?: unknown }).key as string) &&
          !Number.isNaN(Number((s as { score?: unknown }).score)),
      )
      .filter((s) => !seen.has(s.key) && seen.add(s.key))
      .map((s) => ({ key: s.key as SubscoreKey, score: Math.max(0, Math.min(5, Number(s.score))) }));
    const evidence: ScoreEvidence[] = (Array.isArray(parsed.evidence) ? parsed.evidence : [])
      .filter(
        (e: unknown): e is { label: string } =>
          !!e && typeof e === "object" && typeof (e as { label?: unknown }).label === "string" && !!(e as { label: string }).label.trim(),
      )
      .slice(0, 6)
      .map((e) => {
        const raw = e as { label: string; cv_line?: unknown; jd_phrase?: unknown; contribution?: unknown };
        const contribution = Number(raw.contribution);
        return {
          label: raw.label.trim(),
          cvLine: typeof raw.cv_line === "string" ? raw.cv_line.trim() : "",
          jdPhrase: typeof raw.jd_phrase === "string" ? raw.jd_phrase.trim() : "",
          contribution: Number.isNaN(contribution) ? 0 : Math.max(-1, Math.min(1, contribution)),
        };
      });
    return { score, reason: String(parsed.reason ?? ""), fitBullets, subscores, evidence };
  } catch {
    return null;
  }
}
