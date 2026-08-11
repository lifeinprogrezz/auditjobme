// Global fail-closed monthly spend cap — pure logic (issue #35, decided 2026-07-26).
//
// The proxy (index.ts) imports this module; so does the vitest suite
// (src/test/global-cap.test.ts), which is why nothing here may touch Deno,
// the network, or Supabase — index.ts owns the I/O, this module owns the verdict.
//
// Shape (planning repo docs/specs/2026-07-26-economics-decisions.md, "The global
// fail-closed cap: $300/month"): ONE global monthly cap across ALL paths, fail-closed.
// It is a runaway-bug/abuse kill-switch, not a business constraint — set high enough
// that no plausible launch trips it. NO per-user caps at launch (deliberately deferred
// to the two-week/four-week usage reviews; any future per-user daily cap must exempt
// or exceed the service-role path or the score-backlog worker never drains).

/** Default global monthly cap in USD. Override via the GLOBAL_MONTHLY_CAP_USD env var
 *  so the usage reviews can adjust the level without a code change. */
export const GLOBAL_MONTHLY_CAP_DEFAULT_USD = 300;

/**
 * Resolve the cap from an env-var value. Absent/blank/garbage/negative falls back to
 * the default — a mis-set variable must not silently uncap spend. An explicit "0" is
 * honored as a full stop (every LLM call blocked): that is the manual kill-switch.
 */
export function capUsdFromEnv(raw: string | undefined | null): number {
  if (raw == null || String(raw).trim() === '') return GLOBAL_MONTHLY_CAP_DEFAULT_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : GLOBAL_MONTHLY_CAP_DEFAULT_USD;
}

/** ISO timestamp of the start of `now`'s UTC month — the usage_events window the cap reads. */
export function monthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export type CostRow = { cost_usd: number | null };

/** Month-to-date spend from usage_events rows. Null costs count as 0. */
export function sumCostUsd(rows: readonly CostRow[] | null | undefined): number {
  return (rows ?? []).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
}

// User-facing messages. The 429 says what happened and when it resets; the 503
// deliberately does NOT say "cap" — a metering-read outage is transient, not a limit.
export const CAP_TRIPPED_MESSAGE =
  'The monthly free-compute limit has been reached. It resets at the start of next month.';
export const CAP_READ_ERROR_MESSAGE = 'Compute is temporarily paused. Please try again shortly.';

export type CapVerdict =
  | { allowed: true }
  | { allowed: false; status: 429 | 503; message: string };

/**
 * The FAIL-CLOSED verdict. Pass either the month-to-date total or whatever error the
 * usage_events read produced. Precedence:
 *   1. Any read error → BLOCK 503 (a DB outage must not uncap us — fail closed).
 *   2. Missing/non-finite total → BLOCK 503 (an unreadable ledger is a read error).
 *   3. Total at or over the cap → BLOCK 429 (the kill-switch tripped).
 *   4. Otherwise → allowed.
 */
export function globalCapVerdict(input: {
  capUsd: number;
  monthTotalUsd?: number;
  readError?: unknown;
}): CapVerdict {
  if (input.readError != null) {
    return { allowed: false, status: 503, message: CAP_READ_ERROR_MESSAGE };
  }
  const total = input.monthTotalUsd;
  if (typeof total !== 'number' || !Number.isFinite(total)) {
    return { allowed: false, status: 503, message: CAP_READ_ERROR_MESSAGE };
  }
  if (total >= input.capUsd) {
    return { allowed: false, status: 429, message: CAP_TRIPPED_MESSAGE };
  }
  return { allowed: true };
}
