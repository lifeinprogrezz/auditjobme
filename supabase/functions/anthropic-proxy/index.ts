import { createClient } from 'npm:@supabase/supabase-js@2.57.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Sponsored-compute guardrails — enforced SERVER-SIDE (the client never enforces). EVERY LLM
// call in the product routes through this proxy, so these caps bound total spend on our key.
const MONTHLY_KILL_SWITCH_USD = 54; // global monthly cap (~EUR 50)
const PER_USER_DAILY_USD = 1.0;     // one account can't drain the monthly pool in a day
const ALLOWED_KINDS = ['score', 'audit', 'cv', 'letter'];
const MAX_TOKENS_CEILING = 8192;    // hard ceiling: a caller can't request a huge, costly generation
// priceUsd only knows haiku vs sonnet rates, so an unlisted (e.g. pricier) model would be
// under-metered and could outrun the caps — accept only the two the product actually uses.
const ALLOWED_MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-20250514'];
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/** USD cost from token counts, by model family. */
function priceUsd(model: string, inTok: number, outTok: number): number {
  const m = (model || '').toLowerCase();
  const [inRate, outRate] = m.includes('haiku') ? [1.0, 5.0] : [3.0, 15.0]; // USD per million tokens
  return (inTok / 1e6) * inRate + (outTok / 1e6) * outRate;
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Unauthorized' }, 401);

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not configured' }, 500);

    const { messages, model, max_tokens, system, tools, kind } = await req.json();
    if (!messages || !Array.isArray(messages)) return json({ error: 'messages array is required' }, 400);
    if (model && !ALLOWED_MODELS.includes(model)) return json({ error: 'Unsupported model' }, 400);

    // Service-role client for the GLOBAL cap check + authoritative metering (bypasses RLS).
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // --- Cost guardrails. ---
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

    // GLOBAL monthly kill-switch — fails CLOSED: if usage can't be read, pause sponsored
    // compute rather than open the spend gate (a DB outage must not uncap us).
    try {
      const { data: monthRows, error: monthErr } = await admin.from('usage_events').select('cost_usd').gte('created_at', monthStart);
      if (monthErr) throw monthErr;
      const monthTotal = (monthRows ?? []).reduce((s: number, r: { cost_usd: number | null }) => s + Number(r.cost_usd || 0), 0);
      if (monthTotal >= MONTHLY_KILL_SWITCH_USD) {
        return json({ error: 'The monthly free-compute limit has been reached. It resets at the start of next month.' }, 429);
      }
    } catch (e) {
      console.error('global cap check failed — blocking call (fail-closed):', e);
      return json({ error: 'Compute is temporarily paused. Please try again shortly.' }, 503);
    }

    // PER-USER daily cap — fails OPEN: one user's transient read error shouldn't lock them
    // out, since the global kill-switch above is the hard backstop on total spend.
    try {
      const { data: dayRows } = await admin.from('usage_events').select('cost_usd').eq('user_id', user.id).gte('created_at', dayStart);
      const dayTotal = (dayRows ?? []).reduce((s: number, r: { cost_usd: number | null }) => s + Number(r.cost_usd || 0), 0);
      if (dayTotal >= PER_USER_DAILY_USD) {
        return json({ error: 'You have reached your daily limit. Please try again tomorrow.' }, 429);
      }
    } catch (e) {
      console.warn('per-user cap check failed, allowing call:', e);
    }

    const body: Record<string, unknown> = {
      model: model || DEFAULT_MODEL,
      max_tokens: Math.min(Number(max_tokens) || 4096, MAX_TOKENS_CEILING),
      messages,
    };
    if (system) body.system = system;
    if (tools) body.tools = tools;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return json({ error: data.error?.message || `Anthropic API error [${response.status}]` }, response.status);
    }

    // --- Authoritative metering. Never throws (a metering failure must not break generation). ---
    try {
      const inTok = data?.usage?.input_tokens ?? 0;
      const outTok = data?.usage?.output_tokens ?? 0;
      const usedModel = String(body.model);
      await admin.from('usage_events').insert({
        user_id: user.id,
        kind: ALLOWED_KINDS.includes(kind) ? kind : 'score',
        model: usedModel,
        input_tokens: inTok,
        output_tokens: outTok,
        cost_usd: priceUsd(usedModel, inTok, outTok),
      });
    } catch (e) {
      console.warn('usage metering insert failed:', e);
    }

    return json(data, 200);
  } catch (error) {
    console.error('Error proxying to Anthropic:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
