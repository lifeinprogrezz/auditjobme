import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // x-region: every caller pins execution to eu-central-1 (S1 residency); without it in
  // the allow-list the browser passes preflight but blocks the POST ("Failed to fetch").
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Sponsored-compute guardrails — enforced SERVER-SIDE (the client never enforces). EVERY LLM
// call in the product routes through this proxy. SPEND CAPS REMOVED 2026-07-10 (Rober's call,
// pre-ship: don't limit until launch; capping gets redesigned then — planning spec
// 2026-07-10-server-side-scoring-backlog-design.md). Metering below stays: usage_events is
// the observability surface a future cap will read.
const ALLOWED_KINDS = ['score', 'audit', 'cv', 'letter'];
const MAX_TOKENS_CEILING = 8192;    // hard ceiling: a caller can't request a huge, costly generation
// priceUsd only knows haiku vs sonnet rates, so an unlisted (e.g. pricier) model would be
// under-metered and could outrun the caps — accept only the two the product actually uses.
const ALLOWED_MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'];
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** USD cost from token counts, by model family. */
function priceUsd(model: string, inTok: number, outTok: number): number {
  const m = (model || '').toLowerCase();
  const [inRate, outRate] = m.includes('haiku') ? [1.0, 5.0] : [3.0, 15.0]; // USD per million tokens
  return (inTok / 1e6) * inRate + (outTok / 1e6) * outRate;
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/**
 * Constant-time string equality for the service-role auth boundary. Hashing both
 * inputs to a fixed 32-byte SHA-256 digest first means the byte-compare loop runs
 * for a fixed length regardless of the inputs (no length- or content-dependent
 * early exit), so a timing side-channel can't be used to recover the key. Same
 * behaviour as `===`: equal strings → true (equal digests), unequal → false.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/**
 * The `role` claim from a JWT payload, WITHOUT re-verifying the signature. Safe
 * here ONLY because verify_jwt is ON: Supabase's gateway validates the signature
 * before this function runs, so a token that reaches us carrying role
 * "service_role" is a genuinely project-signed service-role credential (anon/user
 * JWTs carry "anon"/"authenticated"). Unlike an exact-string match against the
 * auto-injected SUPABASE_SERVICE_ROLE_KEY, this accepts a caller holding a
 * DIFFERENT-but-valid service_role JWT — the dashboard-legacy key and the injected
 * one diverge after a JWT-secret rotation, which is what 401'd the nightly worker.
 */
function jwtRoleClaim(jwt: string): string | null {
  try {
    const seg = jwt.split('.')[1];
    if (!seg) return null;
    let b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(atob(b64))?.role ?? null;
  } catch {
    return null;
  }
}

type ScoreParams = {
  messages: unknown;
  model?: string;
  max_tokens?: unknown;
  system?: unknown;
  tools?: unknown;
  kind?: unknown;
};

/**
 * The shared generation tail: Anthropic call → authoritative metering, keyed on
 * `userId`. The user-JWT path passes the session user; the service-role path passes
 * target_user_id. Spend caps removed 2026-07-10 (see header note); the model/kind/
 * max-tokens allowlists below remain identical on both paths.
 */
async function runScoring(admin: SupabaseClient, apiKey: string, userId: string, params: ScoreParams) {
  const { messages, model, max_tokens, system, tools, kind } = params;

  const body: Record<string, unknown> = {
    model: model || DEFAULT_MODEL,
    max_tokens: Math.min(Number(max_tokens) || 4096, MAX_TOKENS_CEILING),
    messages,
  };
  if (system) body.system = system;
  if (tools) body.tools = tools;

  const t0 = Date.now();
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  const latencyMs = Date.now() - t0; // inference round-trip (proxy→Anthropic), for benchmarks

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
      user_id: userId,
      kind: ALLOWED_KINDS.includes(kind as string) ? kind : 'score',
      model: usedModel,
      input_tokens: inTok,
      output_tokens: outTok,
      cost_usd: priceUsd(usedModel, inTok, outTok),
      latency_ms: latencyMs,
    });
  } catch (e) {
    console.warn('usage metering insert failed:', e);
  }

  return json(data, 200);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const token = authHeader.slice('Bearer '.length).trim();

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    // Service-role client for the GLOBAL cap check + authoritative metering (bypasses RLS).
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey);

    // ── SERVICE-ROLE PATH (nightly worker) ──────────────────────────────────
    // A project-signed service_role JWT. verify_jwt (gateway) has ALREADY validated
    // the signature before we run, so trusting the decoded role claim is safe — a
    // forged token never reaches this code. Accept EITHER an exact match against the
    // injected key (fast path) OR any gateway-validated service_role JWT (robust: the
    // caller's service_role key and the injected SUPABASE_SERVICE_ROLE_KEY can be
    // different-but-both-valid JWTs after a JWT-secret rotation). ONLY this path may
    // score/meter/cap against a `target_user_id` other than the caller; anon/user
    // JWTs carry role "anon"/"authenticated" and fall through to the user path.
    const isServiceRole =
      (await timingSafeEqual(token, serviceRoleKey)) || jwtRoleClaim(token) === 'service_role';
    if (isServiceRole) {
      const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
      if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not configured' }, 500);
      const { messages, model, max_tokens, system, tools, kind, target_user_id } = await req.json();
      if (typeof target_user_id !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(target_user_id)) {
        return json({ error: 'A valid target_user_id is required for service-role calls' }, 400);
      }
      if (!messages || !Array.isArray(messages)) return json({ error: 'messages array is required' }, 400);
      if (model && !ALLOWED_MODELS.includes(model)) return json({ error: 'Unsupported model' }, 400);
      // Metering keyed on target_user_id (NOT the service key).
      return await runScoring(admin, apiKey, target_user_id, { messages, model, max_tokens, system, tools, kind });
    }

    // ── USER-JWT PATH (unchanged) ───────────────────────────────────────────
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Unauthorized' }, 401);

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not configured' }, 500);

    // NB: target_user_id is intentionally NOT destructured here — a user JWT can
    // never score as anyone but itself.
    const { messages, model, max_tokens, system, tools, kind } = await req.json();
    if (!messages || !Array.isArray(messages)) return json({ error: 'messages array is required' }, 400);
    if (model && !ALLOWED_MODELS.includes(model)) return json({ error: 'Unsupported model' }, 400);

    return await runScoring(admin, apiKey, user.id, { messages, model, max_tokens, system, tools, kind });
  } catch (error) {
    console.error('Error proxying to Anthropic:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
