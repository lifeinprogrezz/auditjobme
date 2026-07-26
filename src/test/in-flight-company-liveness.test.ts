import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression guard (issue #73 slice 2, review round 1). The in-flight COMPANY
// collapse must be liveness-independent, like career-ops' appliedCos: an
// application whose posting has since closed (is_live=false — a third of the prod
// pool at any time) still has to resolve to its company, or that company's other
// roles resurface in the Today queue mid-interview.
//
// No other gate catches a regression here. inFlightCompanyKeys is pure and stays
// green whatever pool you hand it; the hook is supabase-coupled, so the bug lives
// entirely in WHICH pool the caller passes and which rows it fetched. Both are
// one-line edits away from silently reverting, and the symptom is invisible until
// a real posting dies during a real conversation. So pin the call site itself.
describe("useRolesData feeds inFlightCompanyKeys a liveness-independent pool", () => {
  const src = readFileSync(join(process.cwd(), "src/hooks/useRolesData.ts"), "utf8");

  it("passes the applied roles' own rows, not just the live jobs pool", () => {
    const call = /inFlightCompanyKeys\(([\s\S]*?)\)\s*,/.exec(src);
    expect(call, "inFlightCompanyKeys call not found in useRolesData").not.toBeNull();
    expect(
      call![1],
      "the in-flight pool must include appliedJobsRaw — the live `jobs` array alone " +
        "drops any application whose posting has closed, un-collapsing that company",
    ).toContain("appliedJobsRaw");
  });

  it("keeps the is_live filter on the live-pool fetch ONLY", () => {
    const filters = src.match(/\.eq\("is_live", true\)/g) ?? [];
    expect(
      filters.length,
      "exactly one is_live filter belongs in this hook (the paged live-pool fetch). " +
        "The by-id fetches — applied / saved / dismissed — must stay unfiltered so an " +
        "expired posting still resolves (RLS 20260726094000 grants the read).",
    ).toBe(1);
  });
});
