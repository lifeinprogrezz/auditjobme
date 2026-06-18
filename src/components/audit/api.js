import { supabase } from "@/integrations/supabase/client";

/* ═══════════════════ API ═══════════════════ */
export const SONNET = "claude-sonnet-4-6";
export const HAIKU = "claude-haiku-4-5-20251001";

export async function callClaude(messages, opts = {}) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  // Use the user's session token for authenticated edge function calls
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error("Not authenticated");
  const res = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "apikey": supabaseKey,
    },
    body: JSON.stringify({
      messages,
      model: opts.model || SONNET,
      max_tokens: opts.max_tokens || 4096,
      kind: opts.kind || "audit",
      ...(opts.system ? { system: opts.system } : {}),
      ...(opts.tools ? { tools: opts.tools } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API ${res.status}`);
  }
  return res.json();
}

/* Retry wrapper: retries up to maxRetries times with delay between attempts */
export async function callClaudeWithRetry(messages, opts = {}, maxRetries = 3, delayMs = 2000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callClaude(messages, opts);
    } catch (err) {
      lastError = err;
      console.warn(`API call attempt ${attempt}/${maxRetries} failed:`, err.message);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

/* Validation gate: checks that all critical sections have real data */
export function validateSections({ company, diagnosis, proposals, about, contacts }) {
  const missing = [];
  if (!company?.stats?.length) missing.push("company_stats");
  if (!diagnosis?.findings?.length) missing.push("diagnosis");
  if (!proposals?.proposals?.length) missing.push("proposals");
  if (!about?.columns?.length && !about?.stats?.length) missing.push("about");
  if (!Array.isArray(contacts) || contacts.length === 0) missing.push("contacts");
  return missing;
}

export function extractText(d) {
  return (d?.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

export function safeParse(text) {
  try {
    return JSON.parse(text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
  } catch {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) try { return JSON.parse(m[0]); } catch {}
    return null;
  }
}
