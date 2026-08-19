// Pins the per-user scoring prefilter (issue #114): the deterministic prune
// that runs BEFORE any paid score call, shared by api/score-backlog.ts (what
// gets paid for) and useRolesData (what "still scoring" means). Spec:
// planning repo docs/specs/2026-08-19-score-backlog-prefilter-design.md.
import { describe, expect, it } from "vitest";
import {
  FALLBACK_CAP,
  PREFILTER_CAP,
  prefilterJobs,
} from "@/lib/scorePrefilter";

type J = {
  id: string;
  title: string;
  role_family?: string | null;
  sector?: string | null;
  first_seen_at?: string | null;
  posted_at?: string | null;
};

const job = (id: string, over: Partial<J> = {}): J => ({
  id,
  title: "Product Manager",
  role_family: "product",
  sector: null,
  first_seen_at: "2026-08-18T00:00:00Z",
  posted_at: null,
  ...over,
});

const ids = (jobs: J[]) => jobs.map((j) => j.id);

describe("prefilterJobs — role labels", () => {
  it("keeps jobs whose role_family maps from a chosen archetype and drops the rest", () => {
    const jobs = [
      job("pm"),
      job("eng", { title: "Backend Engineer", role_family: "engineering" }),
      job("sales", { title: "Account Executive", role_family: "sales" }),
    ];
    expect(ids(prefilterJobs(jobs, { roles: ["Product"], sectors: [] }))).toEqual(["pm"]);
  });

  it("falls back to the title archetype for role_family=null rows", () => {
    const jobs = [
      job("legacy-pm", { role_family: null }),
      job("legacy-eng", { title: "Software Engineer", role_family: null }),
    ];
    expect(ids(prefilterJobs(jobs, { roles: ["Product"], sectors: [] }))).toEqual(["legacy-pm"]);
  });

  it("matches family-less archetypes (Growth) via the title", () => {
    const jobs = [
      job("growth", { title: "Growth Manager", role_family: "marketing" }),
      job("brand", { title: "Brand Manager", role_family: "marketing" }),
    ];
    expect(ids(prefilterJobs(jobs, { roles: ["Growth"], sectors: [] }))).toEqual(["growth"]);
  });

  it("unions multiple role labels", () => {
    const jobs = [
      job("pm"),
      job("ops", { title: "Logistics Operations Manager", role_family: "operations" }),
      job("eng", { title: "Platform Engineer", role_family: "engineering" }),
    ];
    expect(ids(prefilterJobs(jobs, { roles: ["Product", "Operations"], sectors: [] }))).toEqual([
      "pm",
      "ops",
    ]);
  });
});

describe("prefilterJobs — sector labels", () => {
  it("AND-across with roles; null-sector rows do not pass a sector selection", () => {
    const jobs = [
      job("fintech-pm", { sector: "Fintech" }),
      job("health-pm", { sector: "Health" }),
      job("nosector-pm", { sector: null }),
    ];
    expect(ids(prefilterJobs(jobs, { roles: ["Product"], sectors: ["Fintech"] }))).toEqual([
      "fintech-pm",
    ]);
  });

  it("sector-only labels leave the role dimension ignored", () => {
    const jobs = [
      job("fintech-eng", { title: "Data Engineer", role_family: "engineering", sector: "Fintech" }),
      job("health-pm", { sector: "Health" }),
    ];
    expect(ids(prefilterJobs(jobs, { roles: [], sectors: ["Fintech"] }))).toEqual(["fintech-eng"]);
  });
});

describe("prefilterJobs — order and caps", () => {
  it("returns survivors newest-first (first_seen_at, then posted_at, unknown last)", () => {
    const jobs = [
      job("old", { first_seen_at: "2026-08-01T00:00:00Z" }),
      job("unknown", { first_seen_at: null, posted_at: null }),
      job("new", { first_seen_at: "2026-08-18T00:00:00Z" }),
      job("posted-only", { first_seen_at: null, posted_at: "2026-08-10T00:00:00Z" }),
    ];
    expect(ids(prefilterJobs(jobs, { roles: ["Product"], sectors: [] }))).toEqual([
      "new",
      "posted-only",
      "old",
      "unknown",
    ]);
  });

  it("caps a labelled slice at PREFILTER_CAP, keeping the newest", () => {
    const jobs = Array.from({ length: PREFILTER_CAP + 10 }, (_, i) =>
      job(`j${i}`, { first_seen_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }),
    );
    const out = prefilterJobs(jobs, { roles: ["Product"], sectors: [] });
    expect(out).toHaveLength(PREFILTER_CAP);
    expect(out[0].id).toBe(`j${PREFILTER_CAP + 9}`); // newest survives
    expect(ids(out)).not.toContain("j0"); // oldest is what the cap sheds
  });
});

describe("prefilterJobs — fallback (never empty, never full-catalog)", () => {
  it("no labels at all → newest-first slice capped at FALLBACK_CAP", () => {
    const jobs = Array.from({ length: FALLBACK_CAP + 5 }, (_, i) =>
      job(`j${i}`, {
        title: "Backend Engineer",
        role_family: "engineering",
        first_seen_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
      }),
    );
    const out = prefilterJobs(jobs, { roles: [], sectors: [] });
    expect(out).toHaveLength(FALLBACK_CAP);
    expect(out[0].id).toBe(`j${FALLBACK_CAP + 4}`);
  });

  it("labels that match nothing → same capped fallback instead of an empty slice", () => {
    const jobs = [job("eng", { title: "Backend Engineer", role_family: "engineering" })];
    expect(ids(prefilterJobs(jobs, { roles: ["Product"], sectors: [] }))).toEqual(["eng"]);
  });
});
