// src/lib/usage.ts — AI usage metering.
//
// Records one usage_events row per metered LLM call (tailored CV summary, cover letter, etc).
// Metering is fire-and-forget: it must NEVER throw or break generation. Every path is wrapped
// in try/catch and degrades to a console.warn.
import { supabase } from "@/integrations/supabase/client";

// Haiku pricing (USD per 1M tokens).
const HAIKU_INPUT_PER_MTOK = 1.0;
const HAIKU_OUTPUT_PER_MTOK = 5.0;

export async function recordUsage(opts: {
  kind: "cv" | "letter" | "score" | "audit";
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  try {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;

    const inputTokens = opts.inputTokens ?? 0;
    const outputTokens = opts.outputTokens ?? 0;
    const cost_usd =
      (inputTokens / 1e6) * HAIKU_INPUT_PER_MTOK +
      (outputTokens / 1e6) * HAIKU_OUTPUT_PER_MTOK;

    const { error } = await supabase.from("usage_events").insert({
      user_id: user.id,
      kind: opts.kind,
      model: opts.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd,
    });
    if (error) console.warn("recordUsage: insert failed", error.message);
  } catch (err) {
    console.warn("recordUsage: unexpected error", err);
  }
}
