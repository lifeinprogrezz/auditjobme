import { supabase } from "@/integrations/supabase/client";
import {
  SYSTEM,
  SCORE_MAX_TOKENS,
  buildScoreUserMessage,
  parseScoreResponse,
  RUBRIC_VERSION,
  type ParsedScore,
  type ScoreableProfile,
  type ScoreableJob,
} from "@/lib/scorePrompt";

// Rubric, prompt shaping, and parsing live in scorePrompt.ts (pure, no client
// import) so the nightly worker (api/nightly.ts) reuses the exact same rubric.
// Re-exported here to keep the existing import surface stable.
export { RUBRIC_VERSION, parseScoreResponse };
export type { ScoreableProfile, ScoreableJob };

/** Score a single job against a profile via the anthropic-proxy edge function. Returns null on any failure. */
export async function scoreJob(
  profile: ScoreableProfile,
  job: ScoreableJob,
): Promise<ParsedScore | null> {
  const userMsg = buildScoreUserMessage(profile, job);

  const { data, error } = await supabase.functions.invoke("anthropic-proxy", {
    body: {
      kind: "score",
      model: "claude-haiku-4-5-20251001",
      max_tokens: SCORE_MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    },
  });
  if (error || !data) return null;

  return parseScoreResponse(data?.content?.[0]?.text ?? "");
}
