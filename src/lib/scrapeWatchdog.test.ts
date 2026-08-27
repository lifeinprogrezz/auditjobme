import { describe, it, expect } from "vitest";
import {
  decideDataplaneFreshness,
  decideDispatch,
  buildWatchdogSubject,
  buildWatchdogBody,
  describeDispatch,
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

  it("says so in the subject when it really did restart the workflow itself", () => {
    const verdict = decideDataplaneFreshness({ updatedAt: null, problem: null }, NOW);
    const decision = decideDispatch({
      alert: true,
      tokenPresent: true,
      runHistoryReadable: true,
      lastDispatchAt: null,
      nowMs: NOW,
    });
    // The outcome argument is required to claim a restart. Omitting it makes the
    // email under-claim rather than over-claim, which is the safe direction.
    expect(buildWatchdogSubject(verdict, decision, true)).toContain("restarting the scrape");
    expect(buildWatchdogSubject(verdict, decision)).not.toContain("restarting the scrape");
  });
});

// The email is the only surface a person reads, so it must report what actually
// happened, not what was decided. An email that says "restarting the scrape"
// when GitHub refused the restart costs the whole day: the reader stops looking.
describe("the email never claims a restart that did not happen", () => {
  const staleVerdict = decideDataplaneFreshness({ updatedAt: hoursAgo(27), problem: null }, NOW);
  const willDispatch = decideDispatch({
    alert: true,
    tokenPresent: true,
    runHistoryReadable: true,
    lastDispatchAt: null,
    nowMs: NOW,
  });

  it("says it is restarting only when GitHub accepted the restart", () => {
    const subject = buildWatchdogSubject(staleVerdict, willDispatch, true);
    expect(subject).toContain("restarting the scrape");
    expect(buildWatchdogBody(staleVerdict, willDispatch, "now", true)).toContain("Starting the scrape workflow now");
  });

  it("says the restart failed when GitHub refused it, and tells the reader to act", () => {
    const subject = buildWatchdogSubject(staleVerdict, willDispatch, false);
    const body = buildWatchdogBody(staleVerdict, willDispatch, "now", false);
    expect(subject).not.toContain("restarting the scrape");
    expect(subject).toContain("could not restart it");
    expect(body).not.toContain("Starting the scrape workflow now");
    expect(body).toContain("GitHub refused");
    expect(body).toContain("by hand");
  });

  it("leaves the decision line alone when no restart was attempted", () => {
    const noToken = decideDispatch({
      alert: true,
      tokenPresent: false,
      runHistoryReadable: false,
      lastDispatchAt: null,
      nowMs: NOW,
    });
    const told = describeDispatch(noToken, null);
    expect(told.restarted).toBe(false);
    expect(told.failed).toBe(false);
    expect(told.line).toBe(noToken.reason);
    expect(buildWatchdogSubject(staleVerdict, noToken, null)).not.toContain("restart");
  });

  it("keeps the warm voice with no em-dashes on the failed-restart path", () => {
    const text =
      buildWatchdogSubject(staleVerdict, willDispatch, false) +
      buildWatchdogBody(staleVerdict, willDispatch, "now", false);
    expect(text).not.toContain("\u2014");
  });
});
