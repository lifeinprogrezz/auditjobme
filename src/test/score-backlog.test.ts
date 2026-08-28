import { describe, it, expect } from "vitest";
import { selectBacklog, prioritizeUsers, runPool, shouldSendReadyEmail, buildReadySubject, buildReadyBody, withPriorityJob } from "@/lib/scoreBacklog";

describe("selectBacklog", () => {
  const jobs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("returns only jobs without a score row", () => {
    expect(selectBacklog(jobs, new Set(["b"])).map((j) => j.id)).toEqual(["a", "c"]);
  });
  it("empty scored set → the whole catalog is backlog", () => {
    expect(selectBacklog(jobs, new Set())).toHaveLength(3);
  });
  it("fully scored → empty backlog", () => {
    expect(selectBacklog(jobs, new Set(["a", "b", "c"]))).toEqual([]);
  });
});

describe("prioritizeUsers: issue #160 invite perk (queue priority, not a cap)", () => {
  const users = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("moves referred users first, keeping everyone", () => {
    const out = prioritizeUsers(users, new Set(["c"]));
    expect(out.map((u) => u.id)).toEqual(["c", "a", "b", "d"]);
    expect(out).toHaveLength(users.length); // nobody dropped — order only
  });

  it("stable within each group: no referrals leaves the order untouched", () => {
    expect(prioritizeUsers(users, new Set()).map((u) => u.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("multiple referred users keep their relative order, then the rest keep theirs", () => {
    const out = prioritizeUsers(users, new Set(["d", "b"]));
    expect(out.map((u) => u.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("everyone referred is a no-op reorder", () => {
    const out = prioritizeUsers(users, new Set(["a", "b", "c", "d"]));
    expect(out.map((u) => u.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("empty user list", () => {
    expect(prioritizeUsers([], new Set(["a"]))).toEqual([]);
  });
});

describe("runPool", () => {
  it("processes every item when the deadline is far", async () => {
    const seen: number[] = [];
    const { processed, deadlineHit } = await runPool(
      [1, 2, 3, 4, 5],
      2,
      Number.MAX_SAFE_INTEGER,
      async (n) => {
        seen.push(n);
      },
    );
    expect(processed).toBe(5);
    expect(deadlineHit).toBe(false);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("stops starting new items past the deadline but finishes in-flight ones", async () => {
    // Fake clock: each fn call advances time past the deadline after the first
    // wave, so only the first `limit` items start.
    let t = 0;
    const started: number[] = [];
    const { processed, deadlineHit } = await runPool(
      [1, 2, 3, 4, 5, 6],
      2,
      10,
      async (n) => {
        started.push(n);
        t = 100; // past deadline for every subsequent pull
      },
      () => t,
    );
    // First pull happens pre-deadline; every pull after the clock jump is refused.
    expect(started.length).toBeGreaterThanOrEqual(1);
    expect(started.length).toBeLessThanOrEqual(2); // at most the first wave of `limit` workers
    expect(processed).toBe(started.length); // in-flight work always completes
    expect(deadlineHit).toBe(true);
  });

  it("respects the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool([1, 2, 3, 4, 5, 6, 7, 8], 3, Number.MAX_SAFE_INTEGER, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe("shouldSendReadyEmail", () => {
  it("fires only on empty backlog + unnotified pass", () => {
    expect(shouldSendReadyEmail(0, null)).toBe(true);
    expect(shouldSendReadyEmail(3, null)).toBe(false);
    expect(shouldSendReadyEmail(0, "2026-07-10T12:00:00Z")).toBe(false);
  });
  it("re-fires after the CV-change reset (stamp back to null)", () => {
    expect(shouldSendReadyEmail(0, null)).toBe(true);
  });
});

describe("email copy", () => {
  it("subject pluralizes and handles zero", () => {
    expect(buildReadySubject(7)).toBe("Your roles are scored — 7 strong matches");
    expect(buildReadySubject(1)).toBe("Your roles are scored — 1 strong match");
    expect(buildReadySubject(0)).toBe("Your roles are scored");
  });
  it("body links to the map and reports totals", () => {
    const { text, html } = buildReadyBody(3, 764, "https://northgoing.com/", "targeted");
    expect(text).toContain("764");
    // #114: the pass covers the user's prefiltered slice, not the whole live
    // catalog, and the cap can truncate even that — so no "all", and no claim
    // of a match the prefilter did not actually make.
    expect(text).toContain("match your targets");
    expect(text).not.toContain("live roles");
    expect(text).not.toContain("all ");
    // The globe IS the landing at the bare domain (Rober 7-12) — email links the canonical root.
    expect(text).toContain("https://northgoing.com/");
    expect(html).toContain('href="https://northgoing.com/"');
  });
  it("never calls the no-labels slice a match, because nothing was matched", () => {
    // The newest-N slice for a user who picked no labels is not a set of
    // "matching roles". Saying so would assert the opposite of what happened.
    const { text } = buildReadyBody(2, 1000, "https://northgoing.com/", "newest");
    expect(text).toContain("newest");
    expect(text).not.toContain("match your targets");
  });

  it("zero-strong body stays honest, no fabricated matches", () => {
    const { text } = buildReadyBody(0, 100, "https://northgoing.com/", "targeted");
    expect(text).toContain("None cleared the strong-match bar");
  });
});

// The bug Rober hit immediately: "I click on the score this role and nothing
// happens." The backlog is built from the label prefilter (#114), and a role
// someone ASKS for is by definition one their labels did not select — so the
// priority ordering had nothing to reorder and the click did nothing at all.
describe("withPriorityJob — the named role has to get INTO the list first", () => {
  const pool = [{ id: "a" }, { id: "b" }, { id: "asked" }];
  const none = new Set<string>();

  it("adds a named role the labels pruned out, at the front (mutant: return backlog untouched)", () => {
    const backlog = [{ id: "a" }, { id: "b" }];
    expect(withPriorityJob(backlog, pool, "asked", none, none).map((j) => j.id)).toEqual([
      "asked",
      "a",
      "b",
    ]);
  });

  it("changes nothing when no role was named", () => {
    const backlog = [{ id: "a" }];
    expect(withPriorityJob(backlog, pool, null, none, none)).toEqual(backlog);
    expect(withPriorityJob(backlog, pool, undefined, none, none)).toEqual(backlog);
  });

  it("does not duplicate a role the labels already selected", () => {
    const backlog = [{ id: "asked" }, { id: "a" }];
    expect(withPriorityJob(backlog, pool, "asked", none, none).map((j) => j.id)).toEqual([
      "asked",
      "a",
    ]);
  });

  it("refuses to re-buy a role that is already scored", () => {
    expect(withPriorityJob([{ id: "a" }], pool, "asked", new Set(["asked"]), none).map((j) => j.id)).toEqual(["a"]);
  });

  it("refuses a role already in flight, so an impatient second click costs nothing", () => {
    expect(withPriorityJob([{ id: "a" }], pool, "asked", none, new Set(["asked"])).map((j) => j.id)).toEqual(["a"]);
  });

  it("ignores an id that is not in the live pool at all", () => {
    expect(withPriorityJob([{ id: "a" }], pool, "ghost", none, none).map((j) => j.id)).toEqual(["a"]);
  });

  it("adds AT MOST one role — it is a request, not a way around the prune", () => {
    const out = withPriorityJob([{ id: "a" }], pool, "asked", none, none);
    expect(out).toHaveLength(2);
  });
});
