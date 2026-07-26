// Pure logic for the batched scoring path (issue #96, lever 2) — client-import-free
// (like nightly.ts / scoreBacklog.ts) so the Vercel functions and vitest share it.
//
// WHY BATCH: the Anthropic Message Batches API is a flat 50% discount on input AND
// output, and both server-side scoring workers score roles nobody is waiting on.
// Nothing about the judgment changes: same model, same rubric text, same max_tokens,
// same message payload, same parseScoreResponse validator. The ONLY difference is
// which endpoint the identical request is posted to and when the answer comes back.
// A role that scored 7.4 on the synchronous path scores 7.4 here.
//
// WHY IT NEEDS A TABLE: a batch has no latency guarantee (typically under an hour,
// guaranteed within 24). It outlives the 60s function invocation that submitted it,
// so submission and retrieval happen on different cron ticks and the in-flight state
// lives in public.score_batches (migration 20260726103000).
//
// Spec: GitHub issue #96. Pinned by src/test/score-batch.test.ts.

/**
 * How many roles a NEW user's very first pass scores synchronously, at full price,
 * before the long tail goes to batch.
 *
 * This is the split the batch lever forces: batch has no latency guarantee, and a
 * brand-new user is watching their first results land. Sending their whole catalog
 * slice to batch could mean an empty screen for an hour.
 *
 * ⚠️ THE VALUE BELOW IS PROVISIONAL — Rober sets it. It is a product decision about
 * what someone is willing to wait for, not an implementation detail, so it is
 * deliberately one constant with no other knobs. The pull request that introduced it
 * states what the user experiences at several candidate values; change it here and
 * nothing else moves.
 */
export const SYNC_ONBOARDING_SLICE = 40;

/**
 * Requests per submitted batch. The API ceiling is 100,000, but the retrieval hop
 * runs inside an edge function that has to hold the whole result payload in memory,
 * and the worker has to upsert every row inside one time-budgeted tick. A few
 * hundred keeps both bounded; the remainder is simply picked up on the next tick.
 */
export const BATCH_MAX_REQUESTS = 250;

/** Anthropic's per-request `custom_id` ceiling. A job id (uuid, 36 chars) fits. */
export const CUSTOM_ID_MAX = 64;

export interface BatchRequest {
  custom_id: string;
  params: {
    model: string;
    max_tokens: number;
    system: string;
    messages: { role: "user"; content: string }[];
  };
}

/**
 * Build the batch payload for a set of already-shaped scoring prompts.
 *
 * `params` is byte-for-byte the body the synchronous path posts to /v1/messages
 * (model, max_tokens, system, one user message) — that identity is the whole reason
 * this is a cost change and not a behaviour change. Do not add fields here that the
 * synchronous path does not send.
 *
 * Items beyond BATCH_MAX_REQUESTS are NOT silently dropped: the caller gets back
 * only what fits and re-submits the rest on the next tick (see `chunkForBatch`).
 */
export function buildBatchRequests(
  items: { id: string; userMessage: string }[],
  opts: { model: string; maxTokens: number; system: string },
): BatchRequest[] {
  return items.slice(0, BATCH_MAX_REQUESTS).map((it) => ({
    custom_id: it.id,
    params: {
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: "user" as const, content: it.userMessage }],
    },
  }));
}

/** First BATCH_MAX_REQUESTS items and the untouched remainder, in order. */
export function chunkForBatch<T>(items: T[]): { head: T[]; rest: T[] } {
  return { head: items.slice(0, BATCH_MAX_REQUESTS), rest: items.slice(BATCH_MAX_REQUESTS) };
}

/**
 * The onboarding split. A user's FIRST pass gets `sliceSize` roles scored
 * synchronously so they see results immediately; everything after that goes to
 * batch. Once they have any scores at all, there is nobody waiting on a screen and
 * the whole remainder batches.
 *
 * `sliceSize <= 0` disables the synchronous slice entirely (everything batches).
 */
export function partitionOnboarding<T>(
  backlog: T[],
  isFirstPass: boolean,
  sliceSize: number,
): { sync: T[]; batched: T[] } {
  if (!isFirstPass || sliceSize <= 0) return { sync: [], batched: backlog };
  return { sync: backlog.slice(0, sliceSize), batched: backlog.slice(sliceSize) };
}

export type BatchResultKind = "succeeded" | "errored" | "canceled" | "expired";

export interface ParsedBatchResult {
  customId: string;
  kind: BatchResultKind;
  /** First text block of a succeeded message; "" for every other kind. */
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Parse the JSONL body of a batch's results_url.
 *
 * Results arrive in ANY order — every consumer must key on `customId`, never on
 * position. Malformed lines are skipped rather than throwing: one corrupt line must
 * not cost the caller the other 249 paid-for scores. Non-succeeded results are kept
 * (not silently dropped) so the caller can distinguish "this role failed, retry it
 * next tick" from "this role was never in the batch".
 */
export function parseBatchResults(jsonl: string): ParsedBatchResult[] {
  const out: ParsedBatchResult[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: unknown;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue; // corrupt line — skip it, keep the rest of the batch
    }
    const r = row as {
      custom_id?: unknown;
      result?: { type?: unknown; message?: { content?: unknown; usage?: unknown } };
    };
    if (typeof r.custom_id !== "string" || !r.custom_id) continue;
    const type = r.result?.type;
    const kind: BatchResultKind =
      type === "succeeded" || type === "errored" || type === "canceled" || type === "expired"
        ? type
        : "errored";
    // Mirror scoreViaProxy's block pick: first TEXT block, falling back to content[0]
    // for the plain single-block shape, so the parser downstream sees the same string.
    const content = r.result?.message?.content;
    const blocks = Array.isArray(content)
      ? (content as { type?: string; text?: string }[])
      : [];
    const block = blocks.find((b) => b?.type === "text") ?? blocks[0];
    const usage = (r.result?.message?.usage ?? {}) as {
      input_tokens?: unknown;
      output_tokens?: unknown;
    };
    out.push({
      customId: r.custom_id,
      kind,
      text: kind === "succeeded" && typeof block?.text === "string" ? block.text : "",
      inputTokens: Number(usage.input_tokens) || 0,
      outputTokens: Number(usage.output_tokens) || 0,
    });
  }
  return out;
}

/**
 * Has migration 20260726103000 not landed yet? The migration is applied to prod by
 * hand (schema changes never ride a deploy), so this code ships BEFORE the table
 * exists. When it does, both workers fall back to their previous fully-synchronous
 * behaviour instead of erroring — the run costs full price for a few ticks rather
 * than producing nothing. Same degrade shape as isMissingRubricColumn in nightly.ts.
 */
export function isMissingBatchTable(
  err: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!err) return false;
  const msg = err.message ?? "";
  // 42P01 = undefined_table (Postgres); PGRST205 = unknown table (PostgREST cache).
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  return msg.includes("score_batches") && /(does not exist|not find|unknown)/i.test(msg);
}

/**
 * Is a polled batch ready to retrieve? Anthropic reports `processing_status` of
 * "in_progress" | "canceling" | "ended"; only "ended" has a results_url.
 */
export function isBatchEnded(processingStatus: string | null | undefined): boolean {
  return processingStatus === "ended";
}

/**
 * A batch is abandoned when its rubric no longer matches the current one: the scores
 * it is about to return were produced under a rubric the product has moved off, so
 * persisting them would mix two scoring semantics in one ranking (the same reason
 * the in-app, backlog, and nightly paths all re-score on a RUBRIC_VERSION bump).
 * The paid-for tokens are already spent either way; what this prevents is stale
 * judgments landing in `scores` and looking current.
 */
export function isBatchStale(batchRubricVersion: string, currentRubricVersion: string): boolean {
  return batchRubricVersion !== currentRubricVersion;
}
