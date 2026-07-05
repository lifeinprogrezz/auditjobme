// Pins applyLandedScores (#26): landed scores merge into the jobs array with
// STABLE row order mid-pass (re-sorting per landing churned every map marker),
// and the byScore sort happens only when the pass-end flush asks for it.
import { describe, expect, it } from "vitest";
import { applyLandedScores, type RoleJob } from "@/lib/roles";

function job(id: string, company: string, score: number | null = null): RoleJob {
  return {
    id,
    company,
    title: `${company} PM`,
    url: `https://example.com/${id}`,
    location: null,
    remote: false,
    source: null,
    seniority: null,
    posted_at: null,
    score,
    reason: null,
    city: null,
    lngLat: null,
    domain: null,
  } as RoleJob;
}

describe("applyLandedScores", () => {
  const base = [job("a", "Alpha"), job("b", "Beta"), job("c", "Gamma")];

  it("applies every landed score and reason", () => {
    const landed = new Map([
      ["a", { score: 3.2, reason: "solid fit" }],
      ["c", { score: 4.8, reason: "great fit" }],
    ]);
    const out = applyLandedScores(base, landed, false);
    expect(out.find((j) => j.id === "a")).toMatchObject({ score: 3.2, reason: "solid fit" });
    expect(out.find((j) => j.id === "c")).toMatchObject({ score: 4.8, reason: "great fit" });
    expect(out.find((j) => j.id === "b")).toMatchObject({ score: null, reason: null });
  });

  it("keeps row order stable when sort=false, even when scores would reorder", () => {
    const landed = new Map([["c", { score: 5, reason: null }]]);
    const out = applyLandedScores(base, landed, false);
    expect(out.map((j) => j.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps untouched row identities (no needless rebuilds downstream)", () => {
    const landed = new Map([["a", { score: 1, reason: null }]]);
    const out = applyLandedScores(base, landed, false);
    expect(out[1]).toBe(base[1]);
    expect(out[2]).toBe(base[2]);
  });

  it("sorts by score once when sort=true (pass-end flush)", () => {
    const landed = new Map([
      ["a", { score: 2.1, reason: null }],
      ["c", { score: 4.4, reason: null }],
    ]);
    const out = applyLandedScores(base, landed, true);
    expect(out.map((j) => j.id)).toEqual(["c", "a", "b"]);
  });

  it("is a no-op merge for an empty landed map", () => {
    const out = applyLandedScores(base, new Map(), false);
    expect(out.map((j) => j.id)).toEqual(["a", "b", "c"]);
    expect(out.find((j) => j.id === "a")?.score).toBeNull();
  });
});
