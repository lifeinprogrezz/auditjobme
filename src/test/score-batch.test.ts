// Pins the batched scoring path (issue #96, lever 2). What matters here is not that
// batching works — it is that batching is a COST change and not a BEHAVIOUR change.
// The rubric encodes months of calibration, so the batch payload has to be the same
// bytes the synchronous path sends, and the results have to run through the same
// validator. These tests fail if either drifts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BATCH_MAX_REQUESTS,
  CUSTOM_ID_MAX,
  SYNC_ONBOARDING_SLICE,
  buildBatchRequests,
  chunkForBatch,
  isBatchEnded,
  isBatchStale,
  isMissingBatchTable,
  parseBatchResults,
  partitionOnboarding,
} from "@/lib/scoreBatch";
import { buildScoreSystem, SCORE_MAX_TOKENS, buildScoreUserMessage, parseScoreResponse } from "@/lib/scorePrompt";

const SYSTEM = buildScoreSystem(null); // pre-#34 rows: product-family rubric

const HAIKU = "claude-haiku-4-5-20251001";
const PROFILE = {
  target_seniority: "senior",
  target_cities: ["Barcelona"],
  open_to_remote: true,
  citizenship: "ES",
  eu_work_authorized: true,
  languages: ["English"],
  cv_text: "Marketplace product manager.",
};
const JOB = {
  id: "11111111-1111-1111-1111-111111111111",
  company: "Acme",
  title: "Product Manager",
  location: "Barcelona",
  remote: true,
  seniority: "senior",
  jd_text: "Own the growth surface.",
};

describe("the batch payload is the synchronous payload", () => {
  it("sends the same model, max_tokens, system and user message as the sync call", () => {
    const userMessage = buildScoreUserMessage(PROFILE, JOB);
    const [req] = buildBatchRequests([{ id: JOB.id, userMessage }], {
      model: HAIKU,
      maxTokens: SCORE_MAX_TOKENS,
      system: SYSTEM,
    });
    // This is the whole safety argument for the lever: byte-identical request.
    expect(req.params.model).toBe(HAIKU);
    expect(req.params.max_tokens).toBe(SCORE_MAX_TOKENS);
    expect(req.params.system).toBe(SYSTEM);
    expect(req.params.messages).toEqual([{ role: "user", content: userMessage }]);
  });

  it("carries no field the synchronous path does not send", () => {
    const [req] = buildBatchRequests([{ id: JOB.id, userMessage: "x" }], {
      model: HAIKU,
      maxTokens: SCORE_MAX_TOKENS,
      system: SYSTEM,
    });
    // A stray temperature/tools/thinking field here would be a judgment change
    // smuggled in as a cost change.
    expect(Object.keys(req.params).sort()).toEqual(["max_tokens", "messages", "model", "system"]);
  });

  it("keys each request on the job id, inside Anthropic's custom_id limit", () => {
    const [req] = buildBatchRequests([{ id: JOB.id, userMessage: "x" }], {
      model: HAIKU,
      maxTokens: SCORE_MAX_TOKENS,
      system: SYSTEM,
    });
    expect(req.custom_id).toBe(JOB.id);
    expect(req.custom_id.length).toBeLessThanOrEqual(CUSTOM_ID_MAX);
  });

  it("never submits more than one batch's worth, and chunkForBatch keeps the rest", () => {
    const many = Array.from({ length: BATCH_MAX_REQUESTS + 7 }, (_, i) => ({
      id: `job-${i}`,
      userMessage: "x",
    }));
    expect(buildBatchRequests(many, { model: HAIKU, maxTokens: 10, system: "s" })).toHaveLength(
      BATCH_MAX_REQUESTS,
    );
    const { head, rest } = chunkForBatch(many);
    expect(head).toHaveLength(BATCH_MAX_REQUESTS);
    expect(rest).toHaveLength(7);
    // The overflow is carried, not dropped — dropped roles would never be scored.
    expect([...head, ...rest]).toEqual(many);
  });
});

describe("parseBatchResults", () => {
  const line = (customId: string, text: string, inTok = 100, outTok = 50) =>
    JSON.stringify({
      custom_id: customId,
      result: {
        type: "succeeded",
        message: { content: [{ type: "text", text }], usage: { input_tokens: inTok, output_tokens: outTok } },
      },
    });

  it("keys on custom_id, not position (results arrive in any order)", () => {
    const jsonl = [line("b", "second"), line("a", "first")].join("\n");
    const byId = new Map(parseBatchResults(jsonl).map((r) => [r.customId, r.text]));
    expect(byId.get("a")).toBe("first");
    expect(byId.get("b")).toBe("second");
  });

  it("feeds parseScoreResponse the same string the sync path feeds it", () => {
    const body = JSON.stringify({
      score: 3,
      reason: "ok",
      fit_bullets: ["Your marketplace work maps to their model"],
      subscores: [
        { key: "seniority", score: 4 },
        { key: "geography", score: 5 },
        { key: "work_auth", score: 5 },
        { key: "language", score: 4 },
        { key: "background", score: 3 },
      ],
      evidence: [],
    });
    const [r] = parseBatchResults(line("a", body));
    const parsed = parseScoreResponse(r.text);
    // 0.3*3 + 0.22*4 + 0.2*5 + 0.18*5 + 0.1*4 = 4.08 -> the deterministic blend,
    // exactly as a synchronous response of the same bytes would produce.
    expect(parsed?.score).toBe(4.1);
  });

  it("reads per-request usage so the batch can be metered", () => {
    const [r] = parseBatchResults(line("a", "{}", 1646, 660));
    expect(r.inputTokens).toBe(1646);
    expect(r.outputTokens).toBe(660);
  });

  it("keeps non-succeeded results so the caller can re-queue them", () => {
    const jsonl = [
      line("a", "{}"),
      JSON.stringify({ custom_id: "b", result: { type: "errored", error: { type: "overloaded" } } }),
      JSON.stringify({ custom_id: "c", result: { type: "expired" } }),
    ].join("\n");
    const kinds = new Map(parseBatchResults(jsonl).map((r) => [r.customId, r.kind]));
    expect(kinds.get("a")).toBe("succeeded");
    expect(kinds.get("b")).toBe("errored");
    expect(kinds.get("c")).toBe("expired");
  });

  it("carries no text for a failed result", () => {
    const [r] = parseBatchResults(JSON.stringify({ custom_id: "a", result: { type: "errored" } }));
    expect(r.text).toBe("");
  });

  it("survives a corrupt line without losing the rest of the batch", () => {
    const jsonl = [line("a", "one"), "{not json", "", line("b", "two")].join("\n");
    expect(parseBatchResults(jsonl).map((r) => r.customId)).toEqual(["a", "b"]);
  });

  it("picks the first TEXT block, mirroring scoreViaProxy's block pick", () => {
    const jsonl = JSON.stringify({
      custom_id: "a",
      result: {
        type: "succeeded",
        message: {
          content: [
            { type: "thinking", thinking: "" },
            { type: "text", text: "the score" },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    });
    expect(parseBatchResults(jsonl)[0].text).toBe("the score");
  });
});

describe("partitionOnboarding — the split Rober sizes", () => {
  const backlog = Array.from({ length: 100 }, (_, i) => i);

  it("gives a first-pass user the synchronous slice and batches the tail", () => {
    const { sync, batched } = partitionOnboarding(backlog, true, 40);
    expect(sync).toHaveLength(40);
    expect(batched).toHaveLength(60);
    expect([...sync, ...batched]).toEqual(backlog); // nothing lost, order kept
  });

  it("batches everything for a returning user — nobody is watching", () => {
    const { sync, batched } = partitionOnboarding(backlog, false, 40);
    expect(sync).toEqual([]);
    expect(batched).toEqual(backlog);
  });

  it("treats a zero or negative slice as all-batch", () => {
    expect(partitionOnboarding(backlog, true, 0).sync).toEqual([]);
    expect(partitionOnboarding(backlog, true, -5).batched).toEqual(backlog);
  });

  it("does not over-slice a backlog smaller than the slice", () => {
    const { sync, batched } = partitionOnboarding([1, 2], true, 40);
    expect(sync).toEqual([1, 2]);
    expect(batched).toEqual([]);
  });

  it("keeps the slice size a single named constant", () => {
    expect(SYNC_ONBOARDING_SLICE).toBeGreaterThan(0);
    expect(Number.isInteger(SYNC_ONBOARDING_SLICE)).toBe(true);
  });
});

describe("batch lifecycle predicates", () => {
  it("only an ended batch is retrievable", () => {
    expect(isBatchEnded("ended")).toBe(true);
    expect(isBatchEnded("in_progress")).toBe(false);
    expect(isBatchEnded("canceling")).toBe(false);
    expect(isBatchEnded(null)).toBe(false);
  });

  it("a rubric bump retires an in-flight batch instead of persisting stale judgments", () => {
    expect(isBatchStale("v5", "v6")).toBe(true);
    expect(isBatchStale("v6", "v6")).toBe(false);
  });

  it("recognises the pre-migration schema so the workers can fall back", () => {
    expect(isMissingBatchTable({ code: "42P01", message: 'relation "score_batches" does not exist' })).toBe(true);
    expect(isMissingBatchTable({ code: "PGRST205", message: "Could not find the table" })).toBe(true);
    expect(isMissingBatchTable({ code: "PGRST116", message: "no rows" })).toBe(false);
    expect(isMissingBatchTable(null)).toBe(false);
  });
});

// The proxy is a Deno edge function, so vitest cannot execute it. These read its
// source the same way api-esm-imports.test.ts reads api/ — the guards below are the
// difference between a discounted endpoint and an unmetered one.
describe("anthropic-proxy batch guards", () => {
  const proxy = readFileSync(
    join(process.cwd(), "supabase", "functions", "anthropic-proxy", "index.ts"),
    "utf8",
  );

  it("prices batch work at the 50% discount", () => {
    expect(proxy).toMatch(/const BATCH_DISCOUNT = 0\.5;/);
    expect(proxy).toMatch(/priceUsd\([^)]*BATCH_DISCOUNT\)/);
  });

  it("still meters every batch result per kind and per user", () => {
    // Losing this is losing the ledger the economics decisions are built on.
    expect(proxy).toMatch(/user_id: userId/);
    expect(proxy).toMatch(/kind: ALLOWED_KINDS\.includes\(kind\) \? kind : 'score'/);
    expect(proxy).toMatch(/batch: true/);
  });

  it("applies the model allowlist and max_tokens ceiling on the batch path too", () => {
    const validator = proxy.slice(proxy.indexOf("function validateBatchRequests"));
    expect(validator).toMatch(/ALLOWED_MODELS\.includes/);
    expect(validator).toMatch(/MAX_TOKENS_CEILING/);
    expect(validator).toMatch(/BATCH_MAX_REQUESTS/);
  });

  it("keeps batch operations on the service-role path only", () => {
    // Batch has no latency guarantee — a user-facing caller must never reach it.
    expect(proxy).toMatch(/if \(op !== 'message'\) return await runBatchOp\(/);
  });

  it("agrees with src/lib/scoreBatch.ts on the per-batch request cap", () => {
    expect(proxy).toMatch(new RegExp(`const BATCH_MAX_REQUESTS = ${BATCH_MAX_REQUESTS};`));
  });
});

describe("per-row role-family system prompts (#34 all-vertical)", () => {
  it("an item's own system wins; opts.system is the fallback", () => {
    const engineering = buildScoreSystem("engineering");
    const [withOwn, withFallback] = buildBatchRequests(
      [
        { id: "a", userMessage: "x", system: engineering },
        { id: "b", userMessage: "y" },
      ],
      { model: HAIKU, maxTokens: SCORE_MAX_TOKENS, system: SYSTEM },
    );
    expect(withOwn.params.system).toBe(engineering);
    expect(withFallback.params.system).toBe(SYSTEM);
  });

  it("a per-item system adds no extra request field", () => {
    const [req] = buildBatchRequests(
      [{ id: "a", userMessage: "x", system: buildScoreSystem("sales") }],
      { model: HAIKU, maxTokens: SCORE_MAX_TOKENS, system: SYSTEM },
    );
    expect(Object.keys(req.params).sort()).toEqual(["max_tokens", "messages", "model", "system"]);
  });
});
