// Pins the Today action-queue + coverage-banner helpers (issue #42), the hand-tuned
// digest rules ported in issue #73 (cap-1 per company, in-flight company collapse,
// dismissals), and the nightly-batch readback that issue #72 puts on /today.
import { describe, expect, it } from "vitest";
import {
  buildActionQueue,
  companyKey,
  coverageSummary,
  dailyTopTen,
  dailyTopTenCompleteLine,
  dailyTopTenHeaderLine,
  inFlightCompanyKeys,
  newSectionHeading,
  resolveBatchJobs,
  selectLatestBatch,
  utcDayKey,
  WORTH_APPLYING_MIN,
  type DailyTopSetSnapshot,
  type QueueEntry,
} from "@/lib/product";
import { isInFlightStatus } from "@/lib/tracker";
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

const ids = (q: { queue: { job: RoleJob }[] }) => q.queue.map((e) => e.job.id);

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

describe("companyKey", () => {
  it("prefers the companies-dimension slug", () => {
    expect(companyKey({ company: "Stripe", company_id: "stripe" })).toBe("stripe");
  });

  it("falls back to a case-folded, trimmed name so a scraped casing variant can't split a company", () => {
    expect(companyKey({ company: "  Stripe ", company_id: null })).toBe("stripe");
    expect(companyKey({ company: "STRIPE", company_id: null })).toBe(
      companyKey({ company: "stripe", company_id: null }),
    );
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
    expect(ids(q)).toEqual(["hi", "great2", "mid"]);
  });

  it("excludes applied roles from the queue", () => {
    const q = buildActionQueue(jobs, new Set(["applied", "hi"]));
    expect(ids(q)).toEqual(["great2", "mid"]);
  });

  it("caps the number of ENTRIES only when a finite cap is passed", () => {
    const many = Array.from({ length: 60 }, (_, i) => job(`j${i}`, { score: 4 }));
    expect(buildActionQueue(many, new Set(), { cap: 40 }).queue).toHaveLength(40);
  });

  it("is UNCAPPED by default — More matches scrolls the whole scored pool (Rober 7-25)", () => {
    const many = Array.from({ length: 60 }, (_, i) => job(`j${i}`, { score: 4 }));
    expect(buildActionQueue(many, new Set()).queue).toHaveLength(60);
  });

  it("uses the shared great-fit threshold", () => {
    expect(WORTH_APPLYING_MIN).toBe(4);
  });

  // ── Issue #73 slice 1: cap-1 per company ────────────────────────────────────
  it("collapses a company to its BEST role and carries the rest as '+N more'", () => {
    const q = buildActionQueue(
      [
        job("s1", { company: "Stripe", company_id: "stripe", score: 4.2 }),
        job("s2", { company: "Stripe", company_id: "stripe", score: 4.8 }),
        job("s3", { company: "Stripe", company_id: "stripe", score: 3.9 }),
        job("w1", { company: "Wise", company_id: "wise", score: 4.5 }),
      ],
      new Set(),
    );
    expect(ids(q)).toEqual(["s2", "w1"]); // one row per company, best-first
    expect(q.queue[0].more.map((j) => j.id)).toEqual(["s1", "s3"]); // siblings, best-first
    expect(q.queue[1].more).toEqual([]);
  });

  it("keeps the headline counts as POOL counts — the collapse must not shrink them", () => {
    const q = buildActionQueue(
      [
        job("s1", { company: "Stripe", company_id: "stripe", score: 4.2 }),
        job("s2", { company: "Stripe", company_id: "stripe", score: 4.8 }),
      ],
      new Set(),
    );
    expect(q.queue).toHaveLength(1);
    expect(q.scored).toBe(2);
    expect(q.worthApplying).toBe(2);
  });

  it("collapses on the name when a company has no slug yet (casing-tolerant)", () => {
    const q = buildActionQueue(
      [
        job("a", { company: "Acme", company_id: null, score: 4.0 }),
        job("b", { company: "acme ", company_id: null, score: 4.4 }),
      ],
      new Set(),
    );
    expect(ids(q)).toEqual(["b"]);
    expect(q.queue[0].more.map((j) => j.id)).toEqual(["a"]);
  });

  // ── Issue #73 slice 2: in-flight COMPANY collapse ───────────────────────────
  it("drops every role at a company with a live application (cap-1 at the company level)", () => {
    const q = buildActionQueue(
      [
        job("s1", { company: "Stripe", company_id: "stripe", score: 4.8 }),
        job("s2", { company: "Stripe", company_id: "stripe", score: 4.4 }),
        job("w1", { company: "Wise", company_id: "wise", score: 4.0 }),
      ],
      new Set(),
      { inFlightCompanies: new Set(["stripe"]) },
    );
    expect(ids(q)).toEqual(["w1"]);
  });

  // ── Issue #73 slice 4: dismissals ───────────────────────────────────────────
  it("drops dismissed roles from the queue AND from the '+N more' siblings", () => {
    const q = buildActionQueue(
      [
        job("s1", { company: "Stripe", company_id: "stripe", score: 4.8 }),
        job("s2", { company: "Stripe", company_id: "stripe", score: 4.4 }),
        job("s3", { company: "Stripe", company_id: "stripe", score: 4.1 }),
      ],
      new Set(),
      { dismissedIds: new Set(["s1", "s2"]) },
    );
    expect(ids(q)).toEqual(["s3"]);
    expect(q.queue[0].more).toEqual([]);
  });
});

describe("inFlightCompanyKeys (issue #73 slice 2 — career-ops semantics)", () => {
  const jobs = [
    job("s1", { company: "Stripe", company_id: "stripe" }),
    job("s2", { company: "Stripe", company_id: "stripe" }),
    job("w1", { company: "Wise", company_id: "wise" }),
  ];

  it("collapses the company on every in-flight status", () => {
    for (const status of ["applied", "responded", "interview", "offer"]) {
      expect([...inFlightCompanyKeys(jobs, [{ job_id: "s1", status }], isInFlightStatus)]).toEqual(["stripe"]);
    }
  });

  it("a REJECTED company resurfaces on a new role — rejection is not deprioritization", () => {
    const keys = inFlightCompanyKeys(jobs, [{ job_id: "s1", status: "rejected" }], isInFlightStatus);
    expect(keys.size).toBe(0);
    // ...and the company's OTHER role is back in the queue (the exact applied role
    // stays out via the role-level applied set).
    const q = buildActionQueue(
      [job("s1", { company: "Stripe", company_id: "stripe", score: 4.8 }), job("s2", { company: "Stripe", company_id: "stripe", score: 4.4 })],
      new Set(["s1"]),
      { inFlightCompanies: keys },
    );
    expect(ids(q)).toEqual(["s2"]);
  });

  it("never hides a company on a status it can't identify, or a job in no pool at all", () => {
    expect(inFlightCompanyKeys(jobs, [{ job_id: "s1", status: "ghosted" }], isInFlightStatus).size).toBe(0);
    expect(inFlightCompanyKeys(jobs, [{ job_id: "s1", status: null }], isInFlightStatus).size).toBe(0);
    expect(inFlightCompanyKeys(jobs, [{ job_id: "nope", status: "applied" }], isInFlightStatus).size).toBe(0);
  });

  it("collapses on an applied posting that has LEFT the live pool — liveness-independent", () => {
    // The applied posting closed mid-interview (is_live=false), so it is absent from
    // the live jobs pool. career-ops' appliedCos doesn't care about liveness and
    // neither may this: the caller feeds the application's OWN row (fetched by id,
    // no is_live filter) and the company stays collapsed while the conversation runs.
    const dead = job("s0", { company: "Stripe", company_id: "stripe" });
    const apps = [{ job_id: "s0", status: "interview" }];
    // The live pool alone cannot resolve it — which is exactly why the caller must
    // not pass only live rows.
    expect(inFlightCompanyKeys(jobs, apps, isInFlightStatus).size).toBe(0);
    const keys = inFlightCompanyKeys([dead, ...jobs], apps, isInFlightStatus);
    expect([...keys]).toEqual(["stripe"]);
    // ...and Stripe's other LIVE role does NOT resurface in the queue.
    const q = buildActionQueue(
      [job("s2", { company: "Stripe", company_id: "stripe", score: 4.6 }), job("w1", { company: "Wise", company_id: "wise", score: 4.2 })],
      new Set(),
      { inFlightCompanies: keys },
    );
    expect(ids(q)).toEqual(["w1"]);
  });
});

describe("selectLatestBatch (issue #72 slice 1)", () => {
  const rows = [
    { job_url: "b", batch_date: "2026-07-25", rank: 2 },
    { job_url: "a", batch_date: "2026-07-25", rank: 1 },
    { job_url: "old", batch_date: "2026-07-24", rank: 1 },
  ];

  it("keeps only the most recent batch, in rank order", () => {
    const { batchDate, rows: batch } = selectLatestBatch(rows);
    expect(batchDate).toBe("2026-07-25");
    expect(batch.map((r) => r.job_url)).toEqual(["a", "b"]);
  });

  it("returns an empty batch when the user has never been matched", () => {
    expect(selectLatestBatch([])).toEqual({ batchDate: null, rows: [] });
  });

  it("sinks a rank-less row instead of dropping it", () => {
    const { rows: batch } = selectLatestBatch([
      { job_url: "x", batch_date: "2026-07-25", rank: null },
      { job_url: "y", batch_date: "2026-07-25", rank: 1 },
    ]);
    expect(batch.map((r) => r.job_url)).toEqual(["y", "x"]);
  });
});

describe("newSectionHeading (issue #72 slice 1)", () => {
  const now = new Date("2026-07-26T08:00:00Z");

  it("says 'New today' only when the batch really is today's", () => {
    expect(newSectionHeading("2026-07-26", now)).toBe("New today");
  });

  it("dates an older batch honestly instead of calling it today's", () => {
    expect(newSectionHeading("2026-07-24", now)).toBe("New on 24 Jul");
  });

  it("falls back to a bare heading with no batch / an unparseable date", () => {
    expect(newSectionHeading(null, now)).toBe("New");
    expect(newSectionHeading("not-a-date", now)).toBe("New");
  });
});

describe("resolveBatchJobs (issue #72 slice 1)", () => {
  const jobs = [
    job("j1", { url: "https://x/1", score: 4 }),
    job("j2", { url: "https://x/2", score: 4 }),
    job("j3", { url: "https://x/3", score: 4 }),
  ];
  const batch = [
    { job_url: "https://x/2", batch_date: "2026-07-26", rank: 1 },
    { job_url: "https://x/1", batch_date: "2026-07-26", rank: 2 },
    { job_url: "https://x/gone", batch_date: "2026-07-26", rank: 3 },
  ];

  it("resolves urls to live roles in RANK order and skips a url with no live job", () => {
    expect(resolveBatchJobs(batch, jobs).map((j) => j.id)).toEqual(["j2", "j1"]);
  });

  it("drops roles already applied to or dismissed — it's a to-do list, not an archive", () => {
    expect(resolveBatchJobs(batch, jobs, { appliedIds: new Set(["j2"]) }).map((j) => j.id)).toEqual(["j1"]);
    expect(resolveBatchJobs(batch, jobs, { dismissedIds: new Set(["j1"]) }).map((j) => j.id)).toEqual(["j2"]);
  });

  // The nightly worker scores into daily_matches, not into `scores`, so a role can
  // reach /today before the in-app pass has scored it. Show the number the EMAIL
  // quoted rather than an empty chip — that agreement is the point of issue #72.
  it("shows the emailed score when the app hasn't scored the role yet", () => {
    const unscored = [job("j1", { url: "https://x/1", score: null })];
    const rows = [
      { job_url: "https://x/1", batch_date: "2026-07-26", rank: 1, score: 4.6, reason: "Payments fit", rubric_version: "v9" },
    ];
    const [resolved] = resolveBatchJobs(rows, unscored, { rubricVersion: "v9" });
    expect(resolved.score).toBe(4.6);
    expect(resolved.reason).toBe("Payments fit");
  });

  it("never resurfaces a score from a SUPERSEDED rubric, and never overwrites a live one", () => {
    const rows = [
      { job_url: "https://x/1", batch_date: "2026-07-26", rank: 1, score: 4.6, reason: "old", rubric_version: "v8" },
    ];
    // stale rubric → no overlay
    expect(resolveBatchJobs(rows, [job("j1", { url: "https://x/1", score: null })], { rubricVersion: "v9" })[0].score).toBeNull();
    // no rubric passed → no overlay at all
    expect(resolveBatchJobs(rows, [job("j1", { url: "https://x/1", score: null })])[0].score).toBeNull();
    // the app's own current score always wins
    const rowsCurrent = [{ ...rows[0], rubric_version: "v9" }];
    expect(
      resolveBatchJobs(rowsCurrent, [job("j1", { url: "https://x/1", score: 3.1 })], { rubricVersion: "v9" })[0].score,
    ).toBe(3.1);
  });
});

describe("utcDayKey", () => {
  it("is the UTC calendar day, not the local one", () => {
    expect(utcDayKey(new Date("2026-08-27T23:30:00Z"))).toBe("2026-08-27");
  });
});

describe("dailyTopTen (issue #155, LOCKED decision 2 — a fixed daily set of 10)", () => {
  const entry = (id: string): QueueEntry => ({ job: job(id), more: [] });
  const jobs = ["j1", "j2", "j3"].map((id) => job(id, { score: 4 }));
  const today = "2026-08-27";
  const noOne = new Set<string>();

  it("freezes the current top ten when no snapshot exists yet for today", () => {
    const queueTop = [entry("j1"), entry("j2"), entry("j3")];
    const result = dailyTopTen(queueTop, jobs, today, null, noOne, noOne);
    expect(result.isNew).toBe(true);
    expect(result.jobIds).toEqual(["j1", "j2", "j3"]);
    expect(result.entries.map((e) => e.job.id)).toEqual(["j1", "j2", "j3"]);
    expect(result.total).toBe(3);
    expect(result.doneCount).toBe(0);
  });

  it("replays the SAME set and order on a later same-day call, ignoring a changed live queue", () => {
    const snapshot: DailyTopSetSnapshot = { day: today, jobIds: ["j2", "j1", "j3"] };
    // The live queue re-ranked (j3 now first) — the frozen order must win anyway.
    const queueTop = [entry("j3"), entry("j1"), entry("j2")];
    const result = dailyTopTen(queueTop, jobs, today, snapshot, noOne, noOne);
    expect(result.isNew).toBe(false);
    expect(result.jobIds).toEqual(["j2", "j1", "j3"]);
    expect(result.entries.map((e) => e.job.id)).toEqual(["j2", "j1", "j3"]);
  });

  it("marks an applied or dismissed slot done WITHOUT removing it or pulling in a new role", () => {
    const snapshot: DailyTopSetSnapshot = { day: today, jobIds: ["j1", "j2", "j3"] };
    // The live queue would normally drop j1 (applied) and j2 (dismissed) and let a
    // 4th role hop in — dailyTopTen must not follow it.
    const queueTop = [entry("j3"), entry("j4")];
    const result = dailyTopTen(queueTop, jobs, today, snapshot, new Set(["j1"]), new Set(["j2"]));
    expect(result.jobIds).toEqual(["j1", "j2", "j3"]);
    expect(result.entries.map((e) => e.job.id)).toEqual(["j1", "j2", "j3"]);
    expect(result.entries.map((e) => e.done)).toEqual([true, true, false]);
    expect(result.doneCount).toBe(2);
    expect(result.total).toBe(3);
  });

  it("rolls over to a NEW frozen set on the next UTC day", () => {
    const snapshot: DailyTopSetSnapshot = { day: "2026-08-26", jobIds: ["j1", "j2", "j3"] };
    const queueTop = [entry("j3"), entry("j2")];
    const result = dailyTopTen(queueTop, jobs, today, snapshot, noOne, noOne);
    expect(result.isNew).toBe(true);
    expect(result.jobIds).toEqual(["j3", "j2"]);
  });

  it("skips a frozen id with no resolvable job row instead of rendering a stub", () => {
    const snapshot: DailyTopSetSnapshot = { day: today, jobIds: ["j1", "gone", "j2"] };
    const result = dailyTopTen([], jobs, today, snapshot, noOne, noOne);
    expect(result.jobIds).toEqual(["j1", "gone", "j2"]);
    expect(result.entries.map((e) => e.job.id)).toEqual(["j1", "j2"]);
    expect(result.total).toBe(3);
  });
});

describe("dailyTopTenHeaderLine / dailyTopTenCompleteLine (issue #155)", () => {
  it("reads 'N of TOTAL done today'", () => {
    expect(dailyTopTenHeaderLine(3, 10)).toBe("3 of 10 done today");
    expect(dailyTopTenHeaderLine(0, 7)).toBe("0 of 7 done today");
  });

  it("has no completion line until every slot is done", () => {
    expect(dailyTopTenCompleteLine(9, 10)).toBeNull();
    expect(dailyTopTenCompleteLine(0, 0)).toBeNull();
  });

  it("shows the warm completion line once the set is fully done", () => {
    expect(dailyTopTenCompleteLine(10, 10)).toBe("That is today's ten. New ones tomorrow morning.");
  });
});
