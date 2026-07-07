import { describe, it, expect } from "vitest";
import {
  jobSeenMs,
  selectNewJobsSince,
  rankMatches,
  buildEmailSubject,
  buildEmailBody,
  NIGHTLY_FALLBACK_WINDOW_MS,
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
  it("singularizes for one match", () => {
    expect(buildEmailSubject(1)).toBe("1 role matched to you today");
    expect(buildEmailSubject(7)).toBe("7 roles matched to you today");
  });
});

describe("buildEmailBody", () => {
  const ranked = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      url: `https://x/${i}`,
      company: `Co${i}`,
      title: `Role${i}`,
      score: 5 - i,
      reason: "",
      fitBullets: [],
      rank: i + 1,
    }));

  it("lists up to `preview` roles and a deep link, no files", () => {
    const { text, html } = buildEmailBody(ranked(3), "https://auditjob.me/");
    expect(text).toContain("You have 3 new roles matched to you today.");
    expect(text).toContain("- Co0 — Role0");
    expect(text).toContain("See them all: https://auditjob.me/");
    expect(text).not.toContain("...and"); // 3 <= preview(5)
    expect(html).toContain('<a href="https://auditjob.me/">See them all</a>');
  });

  it("summarizes the overflow beyond the preview count", () => {
    const { text, html } = buildEmailBody(ranked(8), "https://auditjob.me/", 5);
    expect(text).toContain("...and 3 more.");
    expect(html).toContain("...and 3 more.");
    // only the first 5 are itemized
    expect(text).toContain("- Co4 — Role4");
    expect(text).not.toContain("- Co5 — Role5");
  });

  it("escapes HTML-special characters in company/role names", () => {
    const rows = [
      { url: "u", company: "A & B <Inc>", title: 'PM "lead"', score: 5, reason: "", fitBullets: [], rank: 1 },
    ];
    const { html } = buildEmailBody(rows, "https://auditjob.me/");
    expect(html).toContain("A &amp; B &lt;Inc&gt;");
    expect(html).toContain("PM &quot;lead&quot;");
  });
});
