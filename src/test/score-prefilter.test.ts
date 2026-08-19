// Pins the per-user scoring prefilter (issue #114): the deterministic prune
// that runs BEFORE any paid score call, shared by api/score-backlog.ts (what
// gets paid for) and useRolesData (what "still scoring" means). Spec:
// planning repo docs/specs/2026-08-19-score-backlog-prefilter-design.md.
import { describe, expect, it } from "vitest";
import {
  FALLBACK_CAP,
  PREFILTER_CAP,
  prefilterJobs,
  prefilterTierOf,
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

  it("gives a retired archetype (Growth) the family it now belongs to", () => {
    // Issue #70: the picker no longer offers "Growth", but a profile written
    // before the change still holds it. archetypeToFamily places it on
    // `marketing`, so the slice WIDENS from the title-matched rows to the whole
    // family. Widening is the safe direction — the alternative was an empty
    // slice and a map that renders "Not scored" forever.
    const jobs = [
      job("growth", { title: "Growth Manager", role_family: "marketing" }),
      job("brand", { title: "Brand Manager", role_family: "marketing" }),
      job("pm", { title: "Product Manager", role_family: "product" }),
    ];
    expect(ids(prefilterJobs(jobs, { roles: ["Growth"], sectors: [] })).sort()).toEqual([
      "brand",
      "growth",
    ]);
  });

  it("unions multiple role labels", () => {
    const jobs = [
      job("pm"),
      job("ops", { title: "Logistics Operations Manager", role_family: "operations" }),
      job("eng", { title: "Platform Engineer", role_family: "engineering" }),
    ];
    // Membership, not order: these rows share a first_seen_at, so their relative
    // order is decided by the id tiebreak and belongs to the ordering tests below.
    expect(
      ids(prefilterJobs(jobs, { roles: ["Product", "Operations"], sectors: [] })).sort(),
    ).toEqual(["ops", "pm"]);
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

describe("prefilterJobs — fallback", () => {
  it("reports which rung of the ladder produced the slice", () => {
    const jobs = [job("pm", { sector: "Fintech" })];
    expect(prefilterTierOf(jobs, { roles: ["Product"], sectors: ["Fintech"] })).toBe("targeted");
    expect(prefilterTierOf(jobs, { roles: [], sectors: [] })).toBe("newest");
  });

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

  it("role plus sector that matches nothing → drops the sector, keeps the role", () => {
    // 62% of live rows carry no sector at all, and the modal's offline chip list
    // holds sector names the live catalog never uses ("Health" vs "Healthtech"),
    // so a two-chip pick lands on zero matches often. Buying 1000 unrelated roles
    // punishes precise targeting; scoring nothing punishes a typo in our own
    // vocabulary. Honouring the dimension that DID match is the only answer that
    // serves the user, so the sector is what gives way.
    const jobs = [
      job("pm-nosector", { sector: null }),
      job("pm-fintech", { sector: "Fintech" }),
      job("eng", { title: "Backend Engineer", role_family: "engineering", sector: "Health" }),
    ];
    const out = prefilterJobs(jobs, { roles: ["Product"], sectors: ["Insurtech"] });
    expect(ids(out).sort()).toEqual(["pm-fintech", "pm-nosector"]);
    expect(prefilterTierOf(jobs, { roles: ["Product"], sectors: ["Insurtech"] })).toBe("role-only");
  });

  it("labels that match nothing at all → scores NOTHING, never a consolation slice", () => {
    // The first cut paid for the newest 1000 roles of the whole catalog when a
    // user's labels matched none of it, so the more precisely someone targeted,
    // the more likely they were to buy a pile of roles they had ruled out. Only
    // ~38% of live rows carry a sector, so a role plus sector pair misses often.
    const jobs = [job("eng", { title: "Backend Engineer", role_family: "engineering" })];
    expect(prefilterJobs(jobs, { roles: ["Product"], sectors: [] })).toEqual([]);
    expect(prefilterJobs(jobs, { roles: [], sectors: ["Fintech"] })).toEqual([]);
  });
});

describe("prefilterJobs — determinism at the cap boundary", () => {
  // first_seen_at is a statement timestamp, so a whole scrape batch shares one
  // value: the live catalog carries ~186 distinct times across ~8,000 rows, the
  // largest tie group 462 rows. If the cut inside a tie group depended on input
  // order, the worker (a DB read) and the client (the dataplane artifact) would
  // select DIFFERENT slices, the client would wait on roles the worker never
  // scores, and the progress bar would never reach zero.
  const tied = (order: string[]) =>
    order.map((id) => job(id, { first_seen_at: "2026-08-18T00:00:00Z" }));

  it("orders ties the same way regardless of the order they arrive in", () => {
    const a = prefilterJobs(tied(["c", "a", "b"]), { roles: ["Product"], sectors: [] });
    const b = prefilterJobs(tied(["b", "c", "a"]), { roles: ["Product"], sectors: [] });
    expect(ids(a)).toEqual(ids(b));
  });

  it("keeps the same rows on both sides of the cap when every row ties", () => {
    const build = (order: number[]) =>
      order.map((i) =>
        job(`j${String(i).padStart(5, "0")}`, { first_seen_at: "2026-08-18T00:00:00Z" }),
      );
    const forward = Array.from({ length: PREFILTER_CAP + 50 }, (_, i) => i);
    const a = prefilterJobs(build(forward), { roles: ["Product"], sectors: [] });
    const b = prefilterJobs(build([...forward].reverse()), { roles: ["Product"], sectors: [] });
    expect(a).toHaveLength(PREFILTER_CAP);
    expect(ids(a)).toEqual(ids(b));
  });
});
