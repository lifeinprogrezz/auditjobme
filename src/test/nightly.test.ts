import { describe, it, expect } from "vitest";
import {
  jobSeenMs,
  selectNewJobsSince,
  selectNightlyCandidates,
  decideNightlyAction,
  isMissingRubricColumn,
  classifyHistoryRead,
  nightlyBudgetExhausted,
  cronAuthResult,
  rankMatches,
  buildEmailSubject,
  buildEmailBody,
  applyUrl,
  NIGHTLY_FALLBACK_WINDOW_MS,
  NIGHTLY_RUN_BUDGET_MS,
  type ScoredMatch,
} from "@/lib/nightly";

const iso = (ms: number) => new Date(ms).toISOString();

describe("jobSeenMs", () => {
  it("prefers first_seen_at, falls back to posted_at, then 0", () => {
    expect(jobSeenMs({ first_seen_at: "2026-07-06T00:00:00Z", posted_at: "2026-01-01T00:00:00Z" })).toBe(
      Date.parse("2026-07-06T00:00:00Z"),
    );
    expect(jobSeenMs({ first_seen_at: null, posted_at: "2026-07-06T00:00:00Z" })).toBe(
      Date.parse("2026-07-06T00:00:00Z"),
    );
    expect(jobSeenMs({ first_seen_at: null, posted_at: null })).toBe(0);
    expect(jobSeenMs({ first_seen_at: "not-a-date", posted_at: null })).toBe(0);
  });
});

describe("selectNewJobsSince", () => {
  const now = Date.parse("2026-07-07T06:00:00Z");
  const j = (id: string, ms: number) => ({ id, first_seen_at: iso(ms), posted_at: null });

  it("returns only jobs strictly newer than the prior batch date, newest first", () => {
    const since = "2026-07-05"; // midnight UTC 07-05
    const cutoff = Date.parse("2026-07-05T00:00:00Z");
    const jobs = [
      j("old", cutoff - 1000),
      j("boundary", cutoff), // NOT strictly after → excluded
      j("newA", cutoff + 60_000),
      j("newB", cutoff + 120_000),
    ];
    const out = selectNewJobsSince(jobs, since, now);
    expect(out.map((x) => x.id)).toEqual(["newB", "newA"]);
  });

  it("uses the ~24h fallback window on the first night (no prior batch)", () => {
    const jobs = [
      j("stale", now - NIGHTLY_FALLBACK_WINDOW_MS - 60_000),
      j("edge-out", now - NIGHTLY_FALLBACK_WINDOW_MS), // exactly the window, not strictly after
      j("fresh", now - 3_600_000),
    ];
    const out = selectNewJobsSince(jobs, null, now);
    expect(out.map((x) => x.id)).toEqual(["fresh"]);
  });

  it("treats an unparseable since as the fallback window", () => {
    const jobs = [j("fresh", now - 3_600_000), j("old", now - NIGHTLY_FALLBACK_WINDOW_MS - 1)];
    const out = selectNewJobsSince(jobs, "garbage", now);
    expect(out.map((x) => x.id)).toEqual(["fresh"]);
  });
});

describe("selectNightlyCandidates (B2)", () => {
  const now = Date.parse("2026-07-07T06:00:00Z");
  const j = (id: string, url: string, isoT: string) => ({ id, url, first_seen_at: isoT, posted_at: null });

  it("uses a real created_at timestamp as the cutoff, not the bare batch_date", () => {
    // Last night's cron actually ran at 06:00 UTC.
    const priorRunAt = "2026-07-06T06:00:00Z";
    const preRun = j("preRun", "u1", "2026-07-06T03:00:00Z"); // seen in the 00:00–06:00 window, BEFORE last run
    const postRun = j("postRun", "u2", "2026-07-06T09:00:00Z"); // seen AFTER last run
    const jobs = [preRun, postRun];

    // created_at cutoff correctly excludes the already-handled pre-run job.
    const out = selectNightlyCandidates(jobs, priorRunAt, now);
    expect(out.map((x) => x.id)).toEqual(["postRun"]);

    // Regression guard: the OLD batch_date cutoff (parsed as 00:00 UTC) re-selects it.
    const buggy = selectNewJobsSince(jobs, "2026-07-06", now);
    expect(buggy.map((x) => x.id)).toContain("preRun");
  });

  it("excludes any URL already matched in a prior batch (belt-and-suspenders)", () => {
    const a = j("a", "https://x/a", "2026-07-07T05:00:00Z");
    const b = j("b", "https://x/b", "2026-07-07T05:30:00Z");
    const seen = new Set(["https://x/a"]);
    const out = selectNightlyCandidates([a, b], "2026-07-07T00:00:00Z", now, seen);
    expect(out.map((x) => x.url)).toEqual(["https://x/b"]);
  });

  it("keeps first-run fallback-window behaviour when there is no prior batch", () => {
    const stale = j("stale", "u1", iso(now - NIGHTLY_FALLBACK_WINDOW_MS - 60_000));
    const fresh = j("fresh", "u2", iso(now - 3_600_000));
    const out = selectNightlyCandidates([stale, fresh], null, now);
    expect(out.map((x) => x.id)).toEqual(["fresh"]);
  });
});

describe("decideNightlyAction (B3 — notified vs matched split)", () => {
  const V = "v4";
  it("scores when there is no batch today", () => {
    expect(decideNightlyAction([], V)).toBe("score");
  });

  it("skips only when today's batch exists at the current rubric AND was notified", () => {
    expect(decideNightlyAction([{ notified_at: "2026-07-07T06:01:00Z", rubric_version: V }], V)).toBe("skip");
    // any notified row → done (notified_at is stamped across the whole batch)
    expect(
      decideNightlyAction(
        [{ notified_at: "2026-07-07T06:01:00Z", rubric_version: V }, { notified_at: null, rubric_version: V }],
        V,
      ),
    ).toBe("skip");
  });

  it("retries the email when today's current-rubric batch exists but was never notified", () => {
    expect(
      decideNightlyAction([{ notified_at: null, rubric_version: V }, { notified_at: null, rubric_version: V }], V),
    ).toBe("retry-email");
  });

  it("F7: rescores when today's batch was scored under a superseded (or null) rubric", () => {
    // stale rubric, even if already notified → re-score under the new rubric
    expect(decideNightlyAction([{ notified_at: "2026-07-07T06:01:00Z", rubric_version: "v3" }], V)).toBe("rescore");
    // pre-migration rows (null/absent rubric_version) read as stale → rescore once
    expect(decideNightlyAction([{ notified_at: null, rubric_version: null }], V)).toBe("rescore");
    expect(decideNightlyAction([{}], V)).toBe("rescore");
  });
});

describe("cronAuthResult (B1 — fail closed)", () => {
  it("fails CLOSED with 500 when CRON_SECRET is unset", () => {
    expect(cronAuthResult(undefined, "Bearer whatever")).toEqual({
      status: 500,
      error: "CRON_SECRET not configured",
    });
    expect(cronAuthResult("", "Bearer whatever")).toEqual({
      status: 500,
      error: "CRON_SECRET not configured",
    });
  });

  it("rejects a wrong, missing, or array Authorization header with 401", () => {
    expect(cronAuthResult("s3cret", undefined)).toMatchObject({ status: 401 });
    expect(cronAuthResult("s3cret", "Bearer nope")).toMatchObject({ status: 401 });
    expect(cronAuthResult("s3cret", "s3cret")).toMatchObject({ status: 401 }); // no "Bearer " prefix
    expect(cronAuthResult("s3cret", ["Bearer s3cret"])).toMatchObject({ status: 401 }); // array header
  });

  it("returns null (authorized) for the exact Bearer <secret> header", () => {
    expect(cronAuthResult("s3cret", "Bearer s3cret")).toBeNull();
  });
});

describe("rankMatches", () => {
  const m = (url: string, score: number): ScoredMatch => ({
    url,
    company: "Co",
    title: "PM",
    score,
    reason: "",
    fitBullets: [],
  });

  it("sorts highest score first and assigns a 1-based rank", () => {
    const out = rankMatches([m("a", 3.1), m("b", 4.8), m("c", 2.0)]);
    expect(out.map((x) => [x.url, x.rank])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 3],
    ]);
  });

  it("is stable on ties (input order preserved)", () => {
    const out = rankMatches([m("first", 4.0), m("second", 4.0)]);
    expect(out.map((x) => x.url)).toEqual(["first", "second"]);
  });

  it("does not mutate the input array", () => {
    const input = [m("a", 1), m("b", 5)];
    rankMatches(input);
    expect(input.map((x) => x.url)).toEqual(["a", "b"]);
  });
});

describe("buildEmailSubject", () => {
  it("uses a transactional subject with count + optional date", () => {
    expect(buildEmailSubject(1)).toBe("Your job match, 1 new");
    expect(buildEmailSubject(7)).toBe("Your job matches, 7 new");
    expect(buildEmailSubject(7, "Jul 7")).toBe("Your job matches, 7 new (Jul 7)");
  });

  it("carries no em-dash — BRAND.md's copy rule covers email too", () => {
    expect(buildEmailSubject(7, "Jul 7")).not.toContain("\u2014");
  });
});

describe("applyUrl (issue #72 slice 3)", () => {
  it("deep-links a role to its OWN /apply page, url-encoded", () => {
    expect(applyUrl("https://auditjob.me/", "https://boards.co/j?id=1&x=2")).toBe(
      "https://auditjob.me/apply?job=https%3A%2F%2Fboards.co%2Fj%3Fid%3D1%26x%3D2",
    );
  });

  it("tolerates an app url with or without a trailing slash", () => {
    expect(applyUrl("https://auditjob.me", "https://x/1")).toBe(applyUrl("https://auditjob.me/", "https://x/1"));
  });
});

describe("buildEmailBody (issue #72 slice 3)", () => {
  const ranked = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      url: `https://x/${i}`,
      company: `Co${i}`,
      title: `Role${i}`,
      location: i === 0 ? "Barcelona" : null,
      score: 5 - i,
      reason: `Reason${i}`,
      fitBullets: [],
      rank: i + 1,
    }));

  it("gives every role its OWN /apply deep link, plus score, reason, company, location", () => {
    const { text, html } = buildEmailBody(ranked(3), "https://auditjob.me/");
    expect(text).toContain("You have 3 new roles matched to you today.");
    expect(text).toContain("Co0");
    expect(text).toContain("Role0");
    expect(text).toContain("5.0 out of 5 · Barcelona");
    expect(text).toContain("Reason0");
    for (let i = 0; i < 3; i++) expect(text).toContain(applyUrl("https://auditjob.me/", `https://x/${i}`));
    expect(html).toContain(`href="${applyUrl("https://auditjob.me/", "https://x/0")}"`);
    expect(html).toContain("5.0 out of 5 · Barcelona");
    expect(html).toContain("Reason0");
  });

  it("keeps the brand header and the see-them-all link", () => {
    const { text, html } = buildEmailBody(ranked(2), "https://auditjob.me/");
    expect(text.startsWith("auditjob.me")).toBe(true);
    expect(html).toContain("auditjob.me</div>");
    expect(text).toContain("See them all: https://auditjob.me/");
    expect(html).toContain('href="https://auditjob.me/"');
  });

  it("omits the location silently when we don't hold one (never guesses)", () => {
    const { text } = buildEmailBody(ranked(2), "https://auditjob.me/");
    expect(text).toContain("4.0 out of 5\n"); // Co1 has no location: score line only
  });

  it("stays a NOTIFICATION: no images, no campaign chrome, no em-dashes", () => {
    const { text, html } = buildEmailBody(ranked(3), "https://auditjob.me/");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("unsubscribe");
    expect(text).not.toContain("\u2014");
    expect(html).not.toContain("\u2014");
  });

  it("summarizes the overflow beyond the preview count", () => {
    const { text, html } = buildEmailBody(ranked(8), "https://auditjob.me/", 5);
    expect(text).toContain("...and 3 more.");
    expect(html).toContain("...and 3 more.");
    // only the first 5 are itemized
    expect(text).toContain("Role4");
    expect(text).not.toContain("Role5");
  });

  it("escapes HTML-special characters in company/role/reason", () => {
    const rows = [
      {
        url: "https://x/1?a=1&b=2",
        company: "A & B <Inc>",
        title: 'PM "lead"',
        location: null,
        score: 5,
        reason: "5 > 4 & rising",
        fitBullets: [],
        rank: 1,
      },
    ];
    const { html } = buildEmailBody(rows, "https://auditjob.me/");
    expect(html).toContain("A &amp; B &lt;Inc&gt;");
    expect(html).toContain("PM &quot;lead&quot;");
    expect(html).toContain("5 &gt; 4 &amp; rising");
    expect(html).not.toContain("<Inc>");
  });
});

// F7 pre-migration degrade: the handler falls back to column-less select/upsert
// ONLY on the specific unknown-column error for rubric_version.
describe("isMissingRubricColumn", () => {
  it("matches PostgREST unknown-column errors for rubric_version on write and read", () => {
    expect(isMissingRubricColumn({ code: "PGRST204", message: "Could not find the 'rubric_version' column of 'daily_matches' in the schema cache" })).toBe(true);
    expect(isMissingRubricColumn({ code: "42703", message: "column daily_matches.rubric_version does not exist" })).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isMissingRubricColumn(null)).toBe(false);
    expect(isMissingRubricColumn({ code: "PGRST204", message: "Could not find the 'other_col' column" })).toBe(false);
    expect(isMissingRubricColumn({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(false);
    expect(isMissingRubricColumn({ message: "network error while writing rubric_version" })).toBe(false);
  });
});

// #54 general sel.error guard: the daily_matches history read seeds seenUrls (the
// exactly-once guard). "ok" → use rows; "fallback" → pre-F7 missing column, retry
// column-less; "skip" → any OTHER error, so the handler skips the user rather than
// proceeding on empty history and re-notifying already-seen roles.
describe("classifyHistoryRead (#54 sel.error guard)", () => {
  it("returns 'ok' when there is no error", () => {
    expect(classifyHistoryRead(null)).toBe("ok");
    expect(classifyHistoryRead(undefined)).toBe("ok");
  });

  it("returns 'fallback' ONLY for the missing rubric_version column (pre-F7)", () => {
    expect(
      classifyHistoryRead({ code: "42703", message: "column daily_matches.rubric_version does not exist" }),
    ).toBe("fallback");
    expect(
      classifyHistoryRead({ code: "PGRST204", message: "Could not find the 'rubric_version' column of 'daily_matches' in the schema cache" }),
    ).toBe("fallback");
  });

  it("returns 'skip' for any other read error (would empty seenUrls → re-notify)", () => {
    // A generic transient/permission failure — NOT the handled missing-column case.
    expect(classifyHistoryRead({ code: "PGRST301", message: "JWT expired" })).toBe("skip");
    expect(classifyHistoryRead({ code: "08006", message: "connection failure" })).toBe("skip");
    expect(classifyHistoryRead({ message: "fetch failed" })).toBe("skip");
    // An unrelated missing column (not rubric_version) is NOT a safe fallback → skip.
    expect(classifyHistoryRead({ code: "42703", message: "column daily_matches.other_col does not exist" })).toBe("skip");
  });
});

// F6 durable execution: the outer user loop stops starting new users once the time
// budget is spent; the repeat trigger resumes on the next tick.
describe("nightlyBudgetExhausted (F6 durable execution)", () => {
  it("keeps going while inside the budget", () => {
    expect(nightlyBudgetExhausted(1000, 1000)).toBe(false);
    expect(nightlyBudgetExhausted(1000, 1000 + NIGHTLY_RUN_BUDGET_MS - 1)).toBe(false);
  });

  it("stops once the budget is spent (resume on the next tick)", () => {
    expect(nightlyBudgetExhausted(1000, 1000 + NIGHTLY_RUN_BUDGET_MS)).toBe(true);
    expect(nightlyBudgetExhausted(1000, 1000 + NIGHTLY_RUN_BUDGET_MS + 5_000)).toBe(true);
  });

  it("stays comfortably under the 60s Vercel function cap", () => {
    expect(NIGHTLY_RUN_BUDGET_MS).toBeLessThan(60_000);
  });

  it("honours a custom budget", () => {
    expect(nightlyBudgetExhausted(0, 29_999, 30_000)).toBe(false);
    expect(nightlyBudgetExhausted(0, 30_000, 30_000)).toBe(true);
  });
});
