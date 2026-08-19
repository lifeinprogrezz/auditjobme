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
  /** jobs.role_family (#34 all-vertical). Selects the per-family fit block in
   *  buildScoreSystem(); null/absent = pre-all-vertical row → product. */
  role_family?: string | null;
}

// v2 (2026-07-06): added fit_bullets — 3-5 grounded "why you fit" points for the
// /roles detail panel. v3 (2026-07-09): ground the ROLE block on JD-extracted facts
// (yoe_min, geo_eligibility). v4 (2026-07-11, Track D S2): explainable-score data
// contract — per-dimension subscores + cited evidence (verbatim CV line ↔ JD phrase,
// signed contribution), stored as additive keys in scores.signals; the score viz
// consumes them later. Bumping the version re-scores cached rows lazily on next load.
// v5 (2026-07-12, F1 two-layer): the persisted score becomes the deterministic
// blendSubscores() output (raw model 0-5 only as fallback) — a semantics change, so
// cached v4 rows (raw score persisted) re-score lazily via the in-app, backlog, and
// nightly paths rather than mixing raw and blended scores in one ranking.
// v6 (2026-07-12, design direction §5.2): fit_bullets gain a numeric length cap —
// "3 to 4 bullets, each at most 12 words" (mirrors the evidence-quote cap in the
// same prompt) — so the /roles detail one-liners stay scannable; the bump re-scores
// cached rows lazily so the capped bullets propagate on next load.
// v7 (2026-08-11, #34 all-vertical): the system prompt is parametrized by the
// row's role_family — a shared core (seniority/geo/work-auth/language/background,
// unchanged) + a per-family fit block (buildScoreSystem below). Product rows'
// prompt bytes changed too (they gain the product fit block), so the bump
// re-scores cached rows lazily on the usual paths. NOTE (decided 2026-07-26,
// vertical-set spec Decision 1): scored rows should eventually record core_v +
// family_v SEPARATELY so a one-family fit-block bump re-scores only that family;
// today every family launches at f1 under this one composite version, so the
// split key (schema + read-path change) lands with the first independent
// family bump, not here.
export const RUBRIC_VERSION = "v7";

/** The five rubric dimensions, in weighing order — subscores cover exactly these. */
export const SUBSCORE_KEYS = ["seniority", "geography", "work_auth", "language", "background"] as const;
export type SubscoreKey = (typeof SUBSCORE_KEYS)[number];

export interface ScoreSubscore {
  key: SubscoreKey;
  score: number; // 0-5, same scale as the blended score
}

// F1 Layer-1 (2026-07-12): the deterministic display weights for the five rubric
// dimensions — background (the CV↔role substance) heaviest, then the rubric's
// stated priority order. They sum to 1.0 so a weighted blend of five 0-5 subscores
// lands back in [0, 5]. The blend is computed AT SCORE TIME and persisted — no read
// path recomputes it. Changing a weight therefore changes scoring semantics: bump
// RUBRIC_VERSION alongside it so cached rows re-score (in-app + backlog + nightly).
// Pinned by src/test/score.test.ts (blendSubscores). Rule + code move together.
export const SUBSCORE_WEIGHTS: Record<SubscoreKey, number> = {
  background: 0.3,
  seniority: 0.22,
  geography: 0.2,
  work_auth: 0.18,
  language: 0.1,
};

/**
 * Layer-1 deterministic recompute: blend the five v4 subscores into one 0-5 display
 * score with the fixed SUBSCORE_WEIGHTS, INSTEAD of trusting the model's single
 * holistic 0-5. Returns null unless ALL five dimensions are present — a partial or
 * pre-v4 response has no trustworthy breakdown, so the caller falls back to the raw
 * model score. One decimal, clamped to [0, 5]. Pure.
 */
export function blendSubscores(subscores: ScoreSubscore[]): number | null {
  const byKey = new Map(subscores.map((s) => [s.key, s.score]));
  let sum = 0;
  for (const key of SUBSCORE_KEYS) {
    const v = byKey.get(key);
    if (v == null) return null; // require the full rubric to recompute
    sum += v * SUBSCORE_WEIGHTS[key];
  }
  return Math.round(Math.max(0, Math.min(5, sum)) * 10) / 10;
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

// ── All-vertical rubric (#34): shared core + per-family fit block ────────────
// Architecture decided 2026-07-26 (planning repo, vertical-set spec Decision 1):
// the core judges every function the same way (seniority, geography, work
// authorization, language, background weight order); the fit block says what
// "background match" MEANS for that function. Rejected alternative: one rubric
// with the family passed as context — a bump aimed at one family would re-judge
// every other family's rows.

/** The five jobs.role_family values the engine ships (issue #34). */
export type RoleFamily = "product" | "engineering" | "sales" | "marketing" | "operations";

/** Human label per family, used in the scoring prompt ("a Product Manager
 *  role", "an Engineering role"). */
export const ROLE_FAMILY_LABELS: Record<RoleFamily, string> = {
  product: "Product Manager",
  engineering: "Engineering",
  sales: "Sales",
  marketing: "Marketing",
  operations: "Operations",
};

/** Normalize a jobs.role_family value: null/absent/unknown → "product" (every
 *  pre-all-vertical row was ingested under the PM-only gate). */
export function normalizeRoleFamily(family?: string | null): RoleFamily {
  return family && family in ROLE_FAMILY_LABELS ? (family as RoleFamily) : "product";
}

/** Per-family fit blocks — what a strong CV↔role background match means for
 *  this function. Each is versioned f1 (2026-08-11); when one bumps
 *  independently, the core_v/family_v split key lands with it (see the
 *  RUBRIC_VERSION note above). */
export const FAMILY_FIT_BLOCKS: Record<RoleFamily, string> = {
  product:
    "For this Product Manager role, background fit means: evidence of owning a product or feature end to end (discovery, shipping, iteration), measurable outcomes they moved, domain overlap with this company's space, and fluency working with engineers and data.",
  engineering:
    "For this Engineering role, background fit means: overlap between the technologies and systems in their CV and this role's stack, evidence of building and shipping production software, scope match (individual contributor versus lead or manager), and domain familiarity. Data, machine learning and analytics engineering count as engineering backgrounds.",
  sales:
    "For this Sales role, background fit means: match on sales motion and segment (self-serve, mid-market, enterprise), quota-carrying or pipeline-building evidence with numbers, familiarity with this industry and its buyers, and language or territory fit for the market the role covers.",
  marketing:
    "For this Marketing role, background fit means: overlap on channel and discipline (growth, performance, content, brand, product marketing), campaigns or funnels they owned with measurable results, analytics and tooling fluency, and familiarity with this audience or market.",
  operations:
    "For this Operations role, background fit means: evidence of owning processes, budgets or teams (operations, finance, people or strategy), scale match between what they ran and what this role needs, analytical and tooling fluency, and any market-specific or regulatory knowledge the role names.",
};

// The response contract is part of the SHARED core: every family returns the same
// JSON shape, subscore keys and evidence rules, so the parser/blender/viz never
// branch on family.
const SCORE_RESPONSE_CONTRACT = `Return ONLY a JSON object, no other text: {"score": <number 0-5>, "reason": "<one short plain-spoken sentence, no jargon, no em-dashes>", "fit_bullets": ["<3 to 4 short second-person bullets, each at most 12 words, naming a SPECIFIC overlap between THIS person's CV/background and THIS role (e.g. 'Your marketplace growth work maps to their two-sided model'). Ground every bullet in their actual CV and the role; never generic filler; no jargon, no em-dashes. If their CV is weak for this role, say so honestly in fewer bullets.>"], "subscores": [{"key": "seniority", "score": <0-5>}, {"key": "geography", "score": <0-5>}, {"key": "work_auth", "score": <0-5>}, {"key": "language", "score": <0-5>}, {"key": "background", "score": <0-5>}], "evidence": [<3 to 6 objects, each {"label": "<2-4 word factor name>", "cv_line": "<quote copied word-for-word from their CV, at most 12 words, or an empty string if nothing in the CV supports this factor>", "jd_phrase": "<quote copied word-for-word from the role description, at most 12 words, or an empty string>", "contribution": <-1 to 1, negative when this factor pulled the score DOWN>}. Cover the strongest pushes in BOTH directions. Quotes must be exact substrings of the CV or the description; never invent or paraphrase a quote, use an empty string instead.>]}.`;

/**
 * Build the scoring system prompt for one row's role family: shared core
 * (weighing order + response contract, identical across families) + that
 * family's fit block. Replaces the old hard-wired "a Product Manager role"
 * SYSTEM constant (#34). Pass the row's jobs.role_family; null falls back to
 * product (pre-all-vertical rows).
 */
export function buildScoreSystem(roleFamily?: string | null): string {
  const family = normalizeRoleFamily(roleFamily);
  const label = ROLE_FAMILY_LABELS[family];
  const article = /^[aeiou]/i.test(label) ? "an" : "a";
  return `You score how strong a match ${article} ${label} role is for a specific job-seeker, on a 0 to 5 scale (one decimal). 5 means an excellent fit they should prioritize; 0 means a poor fit or one they realistically can't get. Weigh, in roughly this order: seniority match (their target level vs the role's), geography and accessibility (is it in a target city, or remote if they're open to remote), work authorization (their citizenship and EU authorization vs where the role is), language fit, and how well their CV and background match the role. ${FAMILY_FIT_BLOCKS[family]} ${SCORE_RESPONSE_CONTRACT}`;
}

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

/** Normalize a quote/source for substring comparison: fold smart quotes + dashes,
 *  lowercase, collapse whitespace. So a verbatim citation still verifies through the
 *  model's harmless case/whitespace/typography drift, while a genuine fabrication
 *  (a phrase that never appears in the source) still fails. */
function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Stage-2 grounding check: is `quote` a real (normalized) substring of `source`?
 *  An empty quote is trivially grounded (nothing claimed); a non-empty quote against
 *  an empty source is NOT (can't verify → treat as ungrounded). Pure. */
export function isGroundedQuote(quote: string, source: string): boolean {
  const q = normalizeForMatch(quote);
  if (!q) return true;
  const src = normalizeForMatch(source);
  if (!src) return false;
  return src.includes(q);
}

/**
 * Stage-2 extractive citation grounding: blank any cited quote that is NOT a verbatim
 * (normalized) substring of its source, killing hallucinated citations while keeping
 * the honest factor label + contribution.
 *
 * This FAILS CLOSED. An absent source (undefined/null) blanks the quote, exactly as an
 * empty one does. The earlier version kept unverifiable quotes on the reasoning that we
 * "can't verify, so we don't destroy a possibly-real quote" — which is backwards for a
 * product whose rule is cite-or-refuse. Measured on production 2026-08-19: 10,477 stored
 * jdPhrase citations belonged to a job with no jd_text, 9,120 on roles live that day, and
 * 3,575 quoted text found in no structured fact either. One real example — LANCH,
 * "Account Manager (m/w/d)", jd_text empty — carried the invented German sentence
 * "Du baust eigenständig Analysen in Metabase und gehst bei Bedarf direkt in SQL",
 * rendered to the user in quote marks by ScoreBreakdown.
 *
 * An unverifiable quote is not a possibly-real quote worth keeping; it is an unsupported
 * claim being displayed as a citation. The label and contribution survive — those are the
 * model's honest reasoning — and only the quote is dropped. Pure.
 */
export function groundEvidence(
  evidence: ScoreEvidence[],
  sources: { cvText?: string | null; jdText?: string | null },
): ScoreEvidence[] {
  const cv = typeof sources.cvText === "string" ? sources.cvText : "";
  const jd = typeof sources.jdText === "string" ? sources.jdText : "";
  return evidence.map((e) => ({
    ...e,
    cvLine: isGroundedQuote(e.cvLine, cv) ? e.cvLine : "",
    jdPhrase: isGroundedQuote(e.jdPhrase, jd) ? e.jdPhrase : "",
  }));
}

/**
 * Pull the {score, reason, fit_bullets, subscores, evidence} out of the model's raw
 * text and clamp it to a sane range: grabs the first {...} block, coerces score (and
 * each subscore) into [0, 5] and contribution into [-1, 1], drops malformed entries,
 * and returns null on any missing-JSON / malformed / non-numeric response. The v4
 * fields degrade to [] — a response without them still yields a usable score.
 *
 * F1 Layer-1: when the full five-dimension subscore set is present, the returned
 * `score` is the DETERMINISTIC blend (blendSubscores), not the model's raw 0-5.
 * F1 Stage-2: pass `sources` (the CV/JD text this score was produced from) to ground
 * the evidence quotes — hallucinated citations are blanked. Omitting `sources` leaves
 * evidence exactly as the model returned it (used where the source isn't at hand).
 */
export function parseScoreResponse(
  text: string,
  sources?: { cvText?: string | null; jdText?: string | null },
): ParsedScore | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const rawScore = Math.max(0, Math.min(5, Number(parsed.score)));
    if (Number.isNaN(rawScore)) return null;
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
          typeof (s as { score?: unknown }).score === "number" &&
          Number.isFinite((s as { score: number }).score),
      )
      .filter((s: { key: string; score: unknown }) => !seen.has(s.key) && seen.add(s.key))
      .map((s: { key: string; score: unknown }) => ({ key: s.key as SubscoreKey, score: Math.max(0, Math.min(5, Number(s.score))) }));
    const rawEvidence: ScoreEvidence[] = (Array.isArray(parsed.evidence) ? parsed.evidence : [])
      .filter(
        (e: unknown): e is { label: string } =>
          !!e && typeof e === "object" && typeof (e as { label?: unknown }).label === "string" && !!(e as { label: string }).label.trim(),
      )
      .slice(0, 6)
      .map((e: { label: string }) => {
        const raw = e as { label: string; cv_line?: unknown; jd_phrase?: unknown; contribution?: unknown };
        const contribution = Number(raw.contribution);
        return {
          label: raw.label.trim(),
          cvLine: typeof raw.cv_line === "string" ? raw.cv_line.trim() : "",
          jdPhrase: typeof raw.jd_phrase === "string" ? raw.jd_phrase.trim() : "",
          contribution: Number.isNaN(contribution) ? 0 : Math.max(-1, Math.min(1, contribution)),
        };
      });
    // Stage-2: ground the citations against the CV/JD when the caller supplies them.
    const evidence = sources ? groundEvidence(rawEvidence, sources) : rawEvidence;
    // Layer-1: the deterministic blend wins when the full rubric is present; else the
    // model's raw holistic score (partial/pre-v4 responses have no trustworthy split).
    const score = blendSubscores(subscores) ?? rawScore;
    return { score, reason: String(parsed.reason ?? ""), fitBullets, subscores, evidence };
  } catch {
    return null;
  }
}
