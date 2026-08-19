import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.2';
import {
  capUsdFromEnv,
  globalCapVerdict,
  type CapVerdict,
} from './cap.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // x-region: every caller pins execution to eu-central-1 (S1 residency); without it in
  // the allow-list the browser passes preflight but blocks the POST ("Failed to fetch").
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Sponsored-compute guardrails — enforced SERVER-SIDE (the client never enforces). EVERY LLM
// call in the product routes through this proxy. GLOBAL SPEND CAP (issue #35, decided
// 2026-07-26, wired 2026-08-11): ONE fail-closed monthly cap — $300/month default, override
// via GLOBAL_MONTHLY_CAP_USD — on ALL spend paths (user-JWT, service-role, batch_submit),
// read from usage_events month-to-date. It is a runaway-bug/abuse kill-switch, not a business
// constraint; deterministic surfaces are unaffected when it trips. NO per-user caps at launch
// (deliberately deferred to the usage reviews — planning spec 2026-07-26-economics-decisions.md,
// "The global fail-closed cap: $300/month"). Pure verdict logic: ./cap.ts, pinned by
// src/test/global-cap.test.ts.
const ALLOWED_KINDS = ['score', 'audit', 'cv', 'letter', 'answer'];
const MAX_TOKENS_CEILING = 8192;    // hard ceiling: a caller can't request a huge, costly generation
// priceUsd only knows haiku vs sonnet rates, so an unlisted (e.g. pricier) model would be
// under-metered and could outrun the caps — accept only the two the product actually uses.
const ALLOWED_MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'];
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// ── Message Batches (issue #96, lever 2) ─────────────────────────────────────
// Batch is a flat 50% discount on input AND output. Only the service-role workers
// (api/nightly.ts, api/score-backlog.ts) may use it — batch has no latency
// guarantee, so it is never on a user-facing path.
const BATCH_DISCOUNT = 0.5;         // Anthropic Message Batches: 50% off list price
const BATCH_MAX_REQUESTS = 250;     // mirrors src/lib/scoreBatch.ts BATCH_MAX_REQUESTS
const CUSTOM_ID_MAX = 64;           // Anthropic's per-request custom_id ceiling
const BATCH_ID_RE = /^msgbatch_[A-Za-z0-9_-]{1,128}$/;

/** USD cost from token counts, by model family. `discount` is 1 at list price and
 *  BATCH_DISCOUNT for work that went through the Message Batches API. */
function priceUsd(model: string, inTok: number, outTok: number, discount = 1): number {
  const m = (model || '').toLowerCase();
  const [inRate, outRate] = m.includes('haiku') ? [1.0, 5.0] : [3.0, 15.0]; // USD per million tokens
  return ((inTok / 1e6) * inRate + (outTok / 1e6) * outRate) * discount;
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

/**
 * GLOBAL monthly kill-switch — FAIL-CLOSED. Reads month-to-date spend from
 * usage_events (same per-call read + reduce as the pre-9b861db cap; row volume is
 * small at launch scale) and blocks when the cap is reached OR when the read fails
 * (a DB outage must not uncap us). Gates the synchronous generation tail on BOTH
 * auth paths and batch_submit; batch_poll/batch_results stay open — those tokens
 * are already spent, and blocking retrieval would strand paid-for scores unmetered.
 * Returns the blocking Response, or null to proceed.
 */
async function enforceGlobalCap(admin: SupabaseClient): Promise<Response | null> {
  const capUsd = capUsdFromEnv(Deno.env.get('GLOBAL_MONTHLY_CAP_USD'));
  let verdict: CapVerdict;
  try {
    // Summed IN THE DATABASE. Selecting the rows and adding them up here is what
    // broke this: PostgREST returns its first 1000 rows and says nothing, so on
    // 2026-08-19 the cap saw $2.58 of a real $35.03 across 15,422 events — about 7%,
    // widening as usage grows. $300 was unreachable, and the kill switch was inert.
    const { data, error } = await admin.rpc('global_month_spend_usd');
    const total = data == null ? undefined : Number(data);
    verdict = globalCapVerdict({
      capUsd,
      // A non-numeric answer is treated as unreadable, and globalCapVerdict fails
      // closed on that — an unreadable ledger must never read as "spend is zero".
      monthTotalUsd: Number.isFinite(total) ? total : undefined,
      readError: error ?? undefined,
    });
  } catch (e) {
    verdict = globalCapVerdict({ capUsd, readError: e ?? new Error('cap read threw') });
  }
  if (!verdict.allowed) {
    console.error(`global cap blocked call (${verdict.status}, cap $${capUsd}/month)`);
    return json({ error: verdict.message }, verdict.status);
  }
  return null;
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
 * The shared spend-guarded generation tail: global cap → Anthropic call →
 * authoritative metering, keyed on `userId`. The user-JWT path passes the session
 * user; the service-role path passes target_user_id. The global cap (see header
 * note) and the model/kind/max-tokens allowlists are identical on both paths.
 */
async function runScoring(admin: SupabaseClient, apiKey: string, userId: string, params: ScoreParams) {
  const { messages, model, max_tokens, system, tools, kind } = params;

  const blocked = await enforceGlobalCap(admin);
  if (blocked) return blocked;

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

// ── Message Batches: submit / poll / retrieve ────────────────────────────────
// Three thin operations, service-role only. They exist HERE rather than in the
// Vercel workers for the same reason every other call does: ANTHROPIC_API_KEY
// lives in this function's env and nowhere else, and usage_events is written
// server-side where a client can't reach it.

const anthropic = (path: string, apiKey: string, init: RequestInit = {}) =>
  fetch(`https://api.anthropic.com/v1${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  });

/**
 * Validate a batch request array against the SAME guardrails the synchronous path
 * enforces — model allowlist, max_tokens ceiling, request count. Batch is cheaper
 * per token, not exempt: without this, a caller could route an unlisted (pricier)
 * model or an 8k-token generation through the discounted endpoint and be
 * under-metered exactly as on the sync path. Returns an error string, or null.
 */
function validateBatchRequests(requests: unknown): string | null {
  if (!Array.isArray(requests) || requests.length === 0) return 'requests array is required';
  if (requests.length > BATCH_MAX_REQUESTS) return `at most ${BATCH_MAX_REQUESTS} requests per batch`;
  const seen = new Set<string>();
  for (const r of requests) {
    const req = r as { custom_id?: unknown; params?: Record<string, unknown> };
    if (typeof req?.custom_id !== 'string' || !req.custom_id || req.custom_id.length > CUSTOM_ID_MAX) {
      return `each request needs a custom_id of 1-${CUSTOM_ID_MAX} characters`;
    }
    if (seen.has(req.custom_id)) return `duplicate custom_id: ${req.custom_id}`;
    seen.add(req.custom_id);
    const p = req.params;
    if (!p || typeof p !== 'object') return 'each request needs a params object';
    if (typeof p.model !== 'string' || !ALLOWED_MODELS.includes(p.model)) return 'Unsupported model';
    if (typeof p.max_tokens !== 'number' || p.max_tokens <= 0 || p.max_tokens > MAX_TOKENS_CEILING) {
      return `max_tokens must be 1-${MAX_TOKENS_CEILING}`;
    }
    if (!Array.isArray(p.messages) || p.messages.length === 0) return 'each request needs a messages array';
  }
  return null;
}

/**
 * Authoritative metering for a retrieved batch: one usage_events row per SUCCEEDED
 * result, keyed on the target user, priced at the batch discount and flagged
 * `batch: true`. Failed/expired results produced no billable tokens and get no row.
 *
 * Never throws (a metering failure must not cost the caller the retrieved scores).
 * Falls back to an insert without the `batch` flag when migration
 * 20260726103000 has not been applied yet, so cost stays recorded either way —
 * same degrade pattern as daily_matches.rubric_version in api/nightly.ts.
 */
async function meterBatchResults(
  admin: SupabaseClient,
  userId: string,
  kind: string,
  jsonl: string,
): Promise<number> {
  const rows: Record<string, unknown>[] = [];
  for (const line of jsonl.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t);
      if (r?.result?.type !== 'succeeded') continue;
      const msg = r.result.message ?? {};
      const inTok = msg.usage?.input_tokens ?? 0;
      const outTok = msg.usage?.output_tokens ?? 0;
      const usedModel = String(msg.model ?? DEFAULT_MODEL);
      rows.push({
        user_id: userId,
        kind: ALLOWED_KINDS.includes(kind) ? kind : 'score',
        model: usedModel,
        input_tokens: inTok,
        output_tokens: outTok,
        cost_usd: priceUsd(usedModel, inTok, outTok, BATCH_DISCOUNT),
        batch: true,
      });
    } catch {
      // A corrupt result line must not cost the batch its metering — skip it.
    }
  }
  if (rows.length === 0) return 0;
  try {
    const { error } = await admin.from('usage_events').insert(rows);
    if (error) {
      console.warn('batch metering insert failed, retrying without the batch flag:', error.message);
      const { error: retryErr } = await admin
        .from('usage_events')
        .insert(rows.map(({ batch: _b, ...rest }) => rest));
      if (retryErr) console.warn('batch metering retry failed:', retryErr.message);
    }
  } catch (e) {
    console.warn('batch metering insert threw:', e);
  }
  return rows.length;
}

/** Service-role batch operations. `op` defaults to 'message' (the synchronous path). */
async function runBatchOp(
  admin: SupabaseClient,
  apiKey: string,
  op: string,
  body: Record<string, unknown>,
): Promise<Response> {
  if (op === 'batch_submit') {
    const invalid = validateBatchRequests(body.requests);
    if (invalid) return json({ error: invalid }, 400);
    // Batch spends real tokens on submit — the global cap gates it exactly like the
    // sync path. Poll/results are NOT gated: those tokens are already spent.
    const blocked = await enforceGlobalCap(admin);
    if (blocked) return blocked;
    const res = await anthropic('/messages/batches', apiKey, {
      method: 'POST',
      body: JSON.stringify({ requests: body.requests }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Anthropic batch submit error:', data);
      return json({ error: data.error?.message || `Anthropic API error [${res.status}]` }, res.status);
    }
    return json({ id: data.id, processing_status: data.processing_status }, 200);
  }

  const batchId = body.batch_id;
  if (typeof batchId !== 'string' || !BATCH_ID_RE.test(batchId)) {
    return json({ error: 'A valid batch_id is required' }, 400);
  }

  if (op === 'batch_poll') {
    const res = await anthropic(`/messages/batches/${batchId}`, apiKey);
    const data = await res.json();
    if (!res.ok) {
      return json({ error: data.error?.message || `Anthropic API error [${res.status}]` }, res.status);
    }
    return json({ processing_status: data.processing_status, request_counts: data.request_counts }, 200);
  }

  if (op === 'batch_results') {
    const targetUserId = body.target_user_id;
    if (typeof targetUserId !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(targetUserId)) {
      return json({ error: 'A valid target_user_id is required for batch_results' }, 400);
    }
    const head = await anthropic(`/messages/batches/${batchId}`, apiKey);
    const batch = await head.json();
    if (!head.ok) {
      return json({ error: batch.error?.message || `Anthropic API error [${head.status}]` }, head.status);
    }
    if (batch.processing_status !== 'ended' || !batch.results_url) {
      return json({ processing_status: batch.processing_status, jsonl: null }, 200);
    }
    const res = await anthropic(batch.results_url.replace('https://api.anthropic.com/v1', ''), apiKey);
    if (!res.ok) {
      return json({ error: `Anthropic results fetch failed [${res.status}]` }, res.status);
    }
    const jsonl = await res.text();
    // Meter BEFORE returning: the tokens are spent whether or not the worker
    // manages to persist the scores, so the ledger must record them either way.
    const metered = await meterBatchResults(admin, targetUserId, String(body.kind ?? 'score'), jsonl);
    return json({ processing_status: 'ended', jsonl, metered }, 200);
  }

  return json({ error: `Unsupported op: ${op}` }, 400);
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
      const payload = await req.json();
      // Batch operations (issue #96) are service-role ONLY — batch has no latency
      // guarantee, so it must never sit on a user-facing path.
      const op = typeof payload.op === 'string' ? payload.op : 'message';
      if (op !== 'message') return await runBatchOp(admin, apiKey, op, payload);
      const { messages, model, max_tokens, system, tools, kind, target_user_id } = payload;
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
