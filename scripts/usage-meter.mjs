// System-spend metering for the CI enrichment passes (Track D S10). These scripts
// call api.anthropic.com directly (the proxy is user-shaped; CI has no user), so
// they record their own usage_events rows — NULL user_id = system spend — keeping
// ALL Anthropic spend in the one ledger the launch-time cap will read.
// Mirrors the proxy's priceUsd (supabase/functions/anthropic-proxy/index.ts).

const RATE_PER_MTOK = (model) =>
  (model || "").toLowerCase().includes("haiku") ? [1.0, 5.0] : [3.0, 15.0];

/**
 * Collects one row per LLM call, flushes in one bulk insert at the end of the run.
 * Never throws — metering must not break the pass it observes.
 */
export function makeMeter(db, kind) {
  const rows = [];
  return {
    /** Call with the raw Messages API response body (its .usage) after each call. */
    record(model, usage, latencyMs) {
      const inTok = Number(usage?.input_tokens) || 0;
      const outTok = Number(usage?.output_tokens) || 0;
      const [inRate, outRate] = RATE_PER_MTOK(model);
      rows.push({
        user_id: null, // system/CI spend
        kind,
        model,
        input_tokens: inTok,
        output_tokens: outTok,
        cost_usd: (inTok / 1e6) * inRate + (outTok / 1e6) * outRate,
        latency_ms: latencyMs ?? null,
      });
    },
    async flush() {
      if (!db || rows.length === 0) return;
      const total = rows.reduce((s, r) => s + r.cost_usd, 0);
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from("usage_events").insert(rows.slice(i, i + 500));
        if (error) {
          console.warn(`usage-meter: insert failed (${error.message}) — spend still capped by MAX_LLM_CALLS`);
          return;
        }
      }
      console.log(`usage-meter: ${rows.length} ${kind} call(s) metered, $${total.toFixed(4)}`);
    },
  };
}
