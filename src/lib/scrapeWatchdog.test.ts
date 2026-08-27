import { describe, it, expect } from "vitest";
import {
  decideDataplaneFreshness,
  decideDispatch,
  buildWatchdogSubject,
  buildWatchdogBody,
  STALE_AFTER_HOURS,
  DISPATCH_MIN_GAP_HOURS,
} from "./scrapeWatchdog";

const NOW = Date.parse("2026-08-28T08:00:00.000Z");
const hoursAgo = (h: number): string => new Date(NOW - h * 3_600_000).toISOString();

const fresh = { updatedAt: hoursAgo(2.6), problem: null };

describe("decideDataplaneFreshness", () => {
  it("stays quiet when this morning's scrape published the dataplane", () => {
    const v = decideDataplaneFreshness(fresh, NOW);
    expect(v.state).toBe("fresh");
    expect(v.alert).toBe(false);
    expect(v.ageHours).toBe(2.6);
  });

  it("alerts when the artifact is a day old, which is what a missed run looks like", () => {
    // 05:00 UTC yesterday to 08:00 UTC today: the exact shape of 2026-08-27.
    const v = decideDataplaneFreshness({ updatedAt: hoursAgo(27), problem: null }, NOW);
    expect(v.state).toBe("stale");
    expect(v.alert).toBe(true);
    expect(v.ageHours).toBe(27);
  });

  it("holds the threshold either side of the line", () => {
    expect(decideDataplaneFreshness({ updatedAt: hoursAgo(STALE_AFTER_HOURS - 0.1), problem: null }, NOW).alert).toBe(
      false,
    );
    expect(decideDataplaneFreshness({ updatedAt: hoursAgo(STALE_AFTER_HOURS + 0.1), problem: null }, NOW).alert).toBe(
      true,
    );
  });

  // The fail-safe rule. Each of these is a case where the watchdog CANNOT TELL
  // whether the pipeline ran. Every one of them must alert, because an email
  // sent for nothing costs an email and a quiet watchdog costs a day of the
  // product. If any of these ever returns alert:false, the guard is decoration.
  const cannotTell: [string, { updatedAt: string | null; problem: string | null }][] = [
    ["the storage read failed", { updatedAt: null, problem: "connection reset" }],
    ["there is no dataplane.json at all", { updatedAt: null, problem: null }],
    ["the timestamp will not parse", { updatedAt: "not a date", problem: null }],
    ["the timestamp reads in the future", { updatedAt: hoursAgo(-3), problem: null }],
  ];

  for (const [label, probe] of cannotTell) {
    it(`alerts, never assumes health, when ${label}`, () => {
      const v = decideDataplaneFreshness(probe, NOW);
      expect(v.state).toBe("unknown");
      expect(v.alert).toBe(true);
      expect(v.reasons.join(" ").length).toBeGreaterThan(0);
    });
  }

  it("does not call a few minutes of clock skew a broken clock", () => {
    const v = decideDataplaneFreshness({ updatedAt: new Date(NOW + 60_000).toISOString(), problem: null }, NOW);
    expect(v.state).toBe("fresh");
    expect(v.alert).toBe(false);
  });
});

describe("decideDispatch", () => {
  const alerting = {
    alert: true,
    tokenPresent: true,
    runHistoryReadable: true,
    lastDispatchAt: null,
    nowMs: NOW,
  };

  it("starts the workflow when the pool is stale, a token exists and nothing ran today", () => {
    const d = decideDispatch(alerting);
    expect(d.dispatch).toBe(true);
  });

  it("never starts anything while the pipeline is healthy", () => {
    expect(decideDispatch({ ...alerting, alert: false }).dispatch).toBe(false);
  });

  it("degrades to alert-only with no token, and says how to turn it on", () => {
    const d = decideDispatch({ ...alerting, tokenPresent: false });
    expect(d.dispatch).toBe(false);
    expect(d.reason).toContain("SCRAPE_DISPATCH_TOKEN");
  });

  // The loop bound. A failure that repeats every morning must cost one run a
  // day, not a run per invocation.
  it("will not start a second run inside the daily window", () => {
    const d = decideDispatch({ ...alerting, lastDispatchAt: hoursAgo(DISPATCH_MIN_GAP_HOURS - 1) });
    expect(d.dispatch).toBe(false);
    expect(d.reason).toContain("already started");
  });

  it("starts one again once the window has passed", () => {
    expect(decideDispatch({ ...alerting, lastDispatchAt: hoursAgo(DISPATCH_MIN_GAP_HOURS + 1) }).dispatch).toBe(true);
  });

  it("holds off when the run history cannot be read, because the bound must be provable", () => {
    expect(decideDispatch({ ...alerting, runHistoryReadable: false }).dispatch).toBe(false);
  });

  it("holds off when the last run carries an unreadable timestamp", () => {
    expect(decideDispatch({ ...alerting, lastDispatchAt: "yesterday-ish" }).dispatch).toBe(false);
  });

  it("holds off when the last run reads in the future", () => {
    expect(decideDispatch({ ...alerting, lastDispatchAt: hoursAgo(-5) }).dispatch).toBe(false);
  });
});

describe("the email the owner reads", () => {
  it("names the problem and what to check, with no em-dashes", () => {
    const verdict = decideDataplaneFreshness({ updatedAt: hoursAgo(27), problem: null }, NOW);
    const decision = decideDispatch({
      alert: true,
      tokenPresent: false,
      runHistoryReadable: false,
      lastDispatchAt: null,
      nowMs: NOW,
    });
    const subject = buildWatchdogSubject(verdict, decision);
    const body = buildWatchdogBody(verdict, decision, new Date(NOW).toISOString());

    expect(subject).toContain("scrape watchdog");
    expect(subject).not.toContain("restarting");
    expect(body).toContain("27 hours");
    expect(body).toContain("Actions tab");
    expect(body).toContain("2026-08-28T08:00:00.000Z");
    expect(subject + body).not.toContain("—");
  });

  it("says so in the subject when it is restarting the workflow itself", () => {
    const verdict = decideDataplaneFreshness({ updatedAt: null, problem: null }, NOW);
    const decision = decideDispatch({
      alert: true,
      tokenPresent: true,
      runHistoryReadable: true,
      lastDispatchAt: null,
      nowMs: NOW,
    });
    expect(buildWatchdogSubject(verdict, decision)).toContain("restarting the scrape");
  });
});
