// src/lib/proxy.ts — the one door to the anthropic-proxy edge function, used by
// every LLM call in the apply bundle (tailor.ts) and the CV parse (cvParse.ts).
// Pulled out of tailor.ts (issue #151) so tests can mock the transport and pin
// what tailor.ts's callers do around it (retries, JSON parsing) without a real
// network call or a Supabase session.
import { supabase } from "@/integrations/supabase/client";

export const HAIKU = "claude-haiku-4-5-20251001";

export type ProxyMessage = { role: "user" | "assistant"; content: string };

/** The one door to the proxy for every apply-bundle call (the CV parse in cvParse.ts
 *  goes through it too, so the caps and the usage ledger stay in one place). */
export async function callProxy(messages: ProxyMessage[], maxTokens: number, kind: "cv" | "letter" | "answer"): Promise<string> {
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
