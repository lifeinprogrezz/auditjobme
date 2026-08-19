// Pins the global fail-closed monthly spend cap (issue #35, decided 2026-07-26).
// Pure logic lives in supabase/functions/anthropic-proxy/cap.ts; the proxy's
// enforceGlobalCap wires it to usage_events. Rule + code move together: change
// the cap's behavior only alongside cap.ts and this file.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GLOBAL_MONTHLY_CAP_DEFAULT_USD,
  capUsdFromEnv,
  monthStartIso,
  sumCostUsd,
  globalCapVerdict,
  CAP_TRIPPED_MESSAGE,
  CAP_READ_ERROR_MESSAGE,
} from "../../supabase/functions/anthropic-proxy/cap.ts";

describe("capUsdFromEnv", () => {
  it("defaults to $300/month when the env var is absent", () => {
    expect(GLOBAL_MONTHLY_CAP_DEFAULT_USD).toBe(300);
    expect(capUsdFromEnv(undefined)).toBe(300);
    expect(capUsdFromEnv(null)).toBe(300);
  });

  it("honors a valid override so usage reviews can adjust without a code change", () => {
    expect(capUsdFromEnv("500")).toBe(500);
    expect(capUsdFromEnv("12.5")).toBe(12.5);
  });

  it("treats an explicit 0 as the manual full-stop kill-switch", () => {
    expect(capUsdFromEnv("0")).toBe(0);
  });

  it("falls back to the default on blank or garbage values (a mis-set var must not uncap)", () => {
    expect(capUsdFromEnv("")).toBe(300);
    expect(capUsdFromEnv("   ")).toBe(300);
    expect(capUsdFromEnv("abc")).toBe(300);
    expect(capUsdFromEnv("-50")).toBe(300);
    expect(capUsdFromEnv("Infinity")).toBe(300);
  });
});

describe("monthStartIso", () => {
  it("returns the start of the current UTC month", () => {
    expect(monthStartIso(new Date("2026-08-11T15:30:00Z"))).toBe("2026-08-01T00:00:00.000Z");
  });

  it("is UTC-anchored, not local-time-anchored, at month boundaries", () => {
    expect(monthStartIso(new Date("2026-09-01T00:00:00Z"))).toBe("2026-09-01T00:00:00.000Z");
    expect(monthStartIso(new Date("2026-08-31T23:59:59Z"))).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("sumCostUsd", () => {
  it("sums usage_events costs, counting null costs as 0", () => {
    expect(sumCostUsd([{ cost_usd: 1.25 }, { cost_usd: null }, { cost_usd: 0.75 }])).toBe(2);
  });

  it("returns 0 for empty or missing row sets", () => {
    expect(sumCostUsd([])).toBe(0);
    expect(sumCostUsd(null)).toBe(0);
    expect(sumCostUsd(undefined)).toBe(0);
  });
});

describe("globalCapVerdict — the fail-closed kill-switch", () => {
  it("allows spend under the cap", () => {
    expect(globalCapVerdict({ capUsd: 300, monthTotalUsd: 0 })).toEqual({ allowed: true });
    expect(globalCapVerdict({ capUsd: 300, monthTotalUsd: 299.99 })).toEqual({ allowed: true });
  });

  it("trips with 429 at and over the cap", () => {
    const at = globalCapVerdict({ capUsd: 300, monthTotalUsd: 300 });
    const over = globalCapVerdict({ capUsd: 300, monthTotalUsd: 412.07 });
    for (const v of [at, over]) {
      expect(v).toEqual({ allowed: false, status: 429, message: CAP_TRIPPED_MESSAGE });
    }
  });

  it("FAILS CLOSED with 503 on a metering-read error — an outage must not uncap spend", () => {
    const v = globalCapVerdict({
      capUsd: 300,
      monthTotalUsd: 0.01,
      readError: new Error("connection refused"),
    });
    expect(v).toEqual({ allowed: false, status: 503, message: CAP_READ_ERROR_MESSAGE });
  });

  it("FAILS CLOSED when the month total is missing or not a finite number", () => {
    expect(globalCapVerdict({ capUsd: 300 })).toEqual({
      allowed: false,
      status: 503,
      message: CAP_READ_ERROR_MESSAGE,
    });
    expect(globalCapVerdict({ capUsd: 300, monthTotalUsd: NaN }).allowed).toBe(false);
    expect(globalCapVerdict({ capUsd: 300, monthTotalUsd: Infinity }).allowed).toBe(false);
  });

  it("read error outranks a healthy-looking total (never trust a partial read)", () => {
    const v = globalCapVerdict({ capUsd: 300, monthTotalUsd: 5, readError: "PGRST timeout" });
    expect(v.allowed).toBe(false);
    expect(v.allowed === false && v.status).toBe(503);
  });

  it("cap 0 blocks every call (the explicit full stop)", () => {
    expect(globalCapVerdict({ capUsd: 0, monthTotalUsd: 0 })).toEqual({
      allowed: false,
      status: 429,
      message: CAP_TRIPPED_MESSAGE,
    });
  });
});

describe("the cap must not read a truncated ledger (#audit P0)", () => {
  // What shipped: the proxy summed month-to-date spend with
  //   .from('usage_events').select('cost_usd').gte('created_at', monthStart)
  // PostgREST caps that at 1000 rows, silently. Measured on production 2026-08-19:
  // 15,422 events this month, true total $35.03, what the cap could see $2.58.
  // The gap WIDENS with usage, so $300 was unreachable — it would have needed
  // $0.30 an event, about 120x the real cost. The kill switch was inert.
  it("a row-array sum is exactly the shape that under-reported, so the proxy must not use one", () => {
    const source = readFileSync(join(process.cwd(), "supabase/functions/anthropic-proxy/index.ts"), "utf8");
    // The fix is a database-side aggregate. Selecting cost_usd rows to add up in JS
    // is the bug, whatever the row count happens to be today.
    expect(
      /\.from\(\s*['"]usage_events['"]\s*\)[\s\S]{0,200}?\.select\(\s*['"]cost_usd['"]\s*\)/.test(source),
      "the proxy selects cost_usd rows and sums them in JS — PostgREST returns only the first 1000, so the cap under-reports",
    ).toBe(false);
    expect(
      source.includes("global_month_spend_usd"),
      "the proxy should call the global_month_spend_usd() aggregate instead",
    ).toBe(true);
  });

  it("under-reporting is unsafe in the one direction that matters", () => {
    // A truncated read makes the total look SMALLER, so the cap stays open. Pin the
    // direction: at or over the cap must block, and a missing total must block too.
    expect(globalCapVerdict({ capUsd: 300, monthTotalUsd: 299.99 }).allowed).toBe(true);
    expect(globalCapVerdict({ capUsd: 300, monthTotalUsd: 300 }).allowed).toBe(false);
    expect(globalCapVerdict({ capUsd: 300, monthTotalUsd: undefined }).allowed).toBe(false);
  });
});
