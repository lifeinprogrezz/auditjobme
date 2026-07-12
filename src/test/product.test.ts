// Pins the Today action-queue + coverage-banner helpers (issue #42).
import { describe, expect, it } from "vitest";
import { buildActionQueue, coverageSummary, WORTH_APPLYING_MIN } from "@/lib/product";
import type { RoleJob } from "@/lib/roles";

function job(id: string, over: Partial<RoleJob> = {}): RoleJob {
  return {
    id,
    company: over.company ?? `Co${id}`,
    title: "Product Manager",
    url: `https://example.com/${id}`,
    location: null,
    remote: false,
    source: over.source ?? "greenhouse",
    seniority: null,
    posted_at: null,
    score: over.score ?? null,
    reason: null,
    city: null,
    lngLat: null,
    domain: null,
    ...over,
  } as RoleJob;
}

describe("coverageSummary", () => {
  it("counts distinct roles, companies, and sources honestly", () => {
    const c = coverageSummary([
      job("a", { company: "Stripe", company_id: "stripe", source: "greenhouse" }),
      job("b", { company: "Stripe", company_id: "stripe", source: "greenhouse" }),
      job("c", { company: "Wise", company_id: "wise", source: "lever" }),
      job("d", { company: "NoSource", company_id: null, source: null }),
    ]);
    expect(c).toEqual({ roles: 4, companies: 3, sources: 2 });
  });
});

describe("buildActionQueue", () => {
  const jobs = [
    job("hi", { score: 4.6 }),
    job("mid", { score: 3.2 }),
    job("great2", { score: 4.1 }),
    job("applied", { score: 4.9 }),
    job("unscored", { score: null }),
  ];

  it("ranks scored, un-applied roles best-first and counts the headline stats", () => {
    const q = buildActionQueue(jobs, new Set(["applied"]));
    expect(q.total).toBe(5);
    expect(q.scored).toBe(4); // four have a score
    // worth-applying = great bucket (>=4) among actionable (applied excluded): hi + great2
    expect(q.worthApplying).toBe(2);
    expect(q.queue.map((j) => j.id)).toEqual(["hi", "great2", "mid"]);
  });

  it("excludes applied roles from the queue", () => {
    const q = buildActionQueue(jobs, new Set(["applied", "hi"]));
    expect(q.queue.map((j) => j.id)).toEqual(["great2", "mid"]);
  });

  it("caps the queue length", () => {
    const many = Array.from({ length: 60 }, (_, i) => job(`j${i}`, { score: 4 }));
    expect(buildActionQueue(many, new Set(), 40).queue).toHaveLength(40);
  });

  it("uses the shared great-fit threshold", () => {
    expect(WORTH_APPLYING_MIN).toBe(4);
  });
});
