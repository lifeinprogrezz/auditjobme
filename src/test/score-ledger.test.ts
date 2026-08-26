// Pins the shared scoring ledger between the nightly and backlog workers (#135).
//
// Before this, api/nightly.ts wrote its scores only to daily_matches and
// api/score-backlog.ts defined its backlog as "no scores row at the current
// RUBRIC_VERSION". The two workers could not see each other's purchases, so the
// same role was bought twice (measured: 99 duplicate rows over 14 days). The fix
// is one ledger: the nightly writes through to `scores` in the backlog's exact
// shape, and it reuses a current-rubric, current-CV `scores` row instead of
// calling the model again.
import { describe, expect, it } from "vitest";
import { RUBRIC_VERSION } from "@/lib/scorePrompt";
import { splitByLedger, toScoresRow, type LedgerRow } from "@/lib/scoreLedger";

const job = (id: string) => ({ id, title: `role ${id}` });
const row = (
  job_id: string,
  score: number | null,
  cv_hash: string | null,
  signals: LedgerRow["signals"] = null,
): LedgerRow => ({ job_id, score, cv_hash, signals });

describe("splitByLedger", () => {
  it("buys everything when the ledger is empty", () => {
    const { reuse, buy } = splitByLedger([job("a"), job("b")], [], "h1");
    expect(reuse).toEqual([]);
    expect(buy.map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("reuses a current-rubric, same-CV row instead of buying it", () => {
    const ledger = [row("a", 4.2, "h1", { reason: "why", fit_bullets: ["one", "two"] })];
    const { reuse, buy } = splitByLedger([job("a"), job("b")], ledger, "h1");
    expect(buy.map((j) => j.id)).toEqual(["b"]);
    expect(reuse).toEqual([{ job: job("a"), score: 4.2, reason: "why", fitBullets: ["one", "two"] }]);
  });

  it("treats a row with no recorded cv_hash as fresh (pre-#123 rows are never re-bought)", () => {
    const { reuse, buy } = splitByLedger([job("a")], [row("a", 3, null)], "h1");
    expect(buy).toEqual([]);
    expect(reuse[0].job.id).toBe("a");
  });

  it("buys again when the row was scored from a different CV", () => {
    const { reuse, buy } = splitByLedger([job("a")], [row("a", 3, "old")], "new");
    expect(reuse).toEqual([]);
    expect(buy.map((j) => j.id)).toEqual(["a"]);
  });

  it("buys again when the ledger row carries no score", () => {
    const { buy } = splitByLedger([job("a")], [row("a", null, "h1")], "h1");
    expect(buy.map((j) => j.id)).toEqual(["a"]);
  });

  it("degrades missing signals to empty reason and bullets, never throws", () => {
    const bad = { fit_bullets: "not-an-array" } as unknown as LedgerRow["signals"];
    const { reuse } = splitByLedger([job("a")], [row("a", 2.5, "h1", bad)], "h1");
    expect(reuse[0]).toEqual({ job: job("a"), score: 2.5, reason: "", fitBullets: [] });
  });

  it("keeps candidate order across both partitions", () => {
    const ledger = [row("b", 1, "h1"), row("d", 2, "h1")];
    const { reuse, buy } = splitByLedger([job("a"), job("b"), job("c"), job("d")], ledger, "h1");
    expect(buy.map((j) => j.id)).toEqual(["a", "c"]);
    expect(reuse.map((r) => r.job.id)).toEqual(["b", "d"]);
  });
});

describe("toScoresRow", () => {
  it("produces the exact upsert shape the backlog worker writes", () => {
    const parsed = {
      score: 4.1,
      reason: "fits",
      fitBullets: ["x"],
      subscores: [{ key: "seniority" as const, score: 4 }],
      evidence: [{ label: "l", cvLine: "", jdPhrase: "", contribution: 0.5 }],
    };
    expect(toScoresRow("u1", "j1", parsed, "h1")).toEqual({
      user_id: "u1",
      job_id: "j1",
      score: 4.1,
      rubric_version: RUBRIC_VERSION,
      cv_hash: "h1",
      signals: { reason: "fits", fit_bullets: ["x"], subscores: parsed.subscores, evidence: parsed.evidence },
    });
  });
});
