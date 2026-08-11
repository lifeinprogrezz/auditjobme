// Pins the liveness-sweep verdict logic (scripts/liveness-lib.mjs), ported from
// career-ops liveness-pre-render.mjs (issue #68 item 1). The retire contract:
// ONLY 404/410 and slug-dropping redirects are "dead"; 403/5xx/timeouts are
// "unverified" and never auto-killed; LinkedIn URLs are never even fetched.
import { describe, expect, it } from "vitest";
import {
  BOARD_KINDS,
  classifyLiveness,
  checkUrl,
  isDeadRedirect,
  isUncheckableUrl,
} from "../../scripts/liveness-lib.mjs";

const ATS = "https://jobs.example.com/jobs/senior-product-manager-4421";

describe("classifyLiveness", () => {
  it("404 and 410 are dead", () => {
    expect(classifyLiveness({ url: ATS, status: 404, ok: false, finalUrl: ATS })).toEqual({
      verdict: "dead",
      reason: "http-404",
    });
    expect(classifyLiveness({ url: ATS, status: 410, ok: false, finalUrl: ATS })).toEqual({
      verdict: "dead",
      reason: "http-410",
    });
  });

  it("a followed redirect that lands on a generic jobs index is dead (slug dropped)", () => {
    const r = classifyLiveness({ url: ATS, status: 200, ok: true, finalUrl: "https://jobs.example.com/jobs" });
    expect(r.verdict).toBe("dead");
    expect(r.reason).toBe("silent-redirect-drops-slug");
  });

  it("an unfollowed 30x to a generic jobs index is dead", () => {
    const r = classifyLiveness({ url: ATS, status: 301, ok: false, finalUrl: "https://jobs.example.com/careers" });
    expect(r).toEqual({ verdict: "dead", reason: "redirect-drops-slug" });
  });

  it("403 / 429 / 5xx / non-ok are unverified — NEVER dead", () => {
    expect(classifyLiveness({ url: ATS, status: 403, ok: false, finalUrl: ATS }).verdict).toBe("unverified");
    expect(classifyLiveness({ url: ATS, status: 429, ok: false, finalUrl: ATS }).verdict).toBe("unverified");
    expect(classifyLiveness({ url: ATS, status: 500, ok: false, finalUrl: ATS }).verdict).toBe("unverified");
    expect(classifyLiveness({ url: ATS, status: 503, ok: false, finalUrl: ATS }).verdict).toBe("unverified");
  });

  it("200 on the same path is live", () => {
    expect(classifyLiveness({ url: ATS, status: 200, ok: true, finalUrl: ATS })).toEqual({
      verdict: "live",
      reason: "http-200",
    });
  });

  it("cross-host redirects are too ambiguous to kill", () => {
    const r = classifyLiveness({ url: ATS, status: 200, ok: true, finalUrl: "https://other.example.org/jobs" });
    expect(r.verdict).toBe("live");
  });

  it("LinkedIn URLs are unverified regardless of status (authwall false-kill guard)", () => {
    const li = "https://www.linkedin.com/jobs/view/product-manager-at-lumapps-4123456789";
    expect(classifyLiveness({ url: li, status: 404, ok: false, finalUrl: li })).toEqual({
      verdict: "unverified",
      reason: "linkedin-not-checkable",
    });
  });
});

describe("isDeadRedirect", () => {
  it("flags a drastic same-host path shortening as a slug drop", () => {
    expect(isDeadRedirect("https://jobs.example.com/j", ATS)).toBe(true);
  });
  it("does not flag the same path or a cross-host move", () => {
    expect(isDeadRedirect(ATS, ATS)).toBe(false);
    expect(isDeadRedirect("https://elsewhere.com/careers", ATS)).toBe(false);
  });
});

describe("isUncheckableUrl", () => {
  it("marks LinkedIn hosts and unparseable URLs", () => {
    expect(isUncheckableUrl("https://www.linkedin.com/jobs/view/123")).toBe(true);
    expect(isUncheckableUrl("not a url")).toBe(true);
    expect(isUncheckableUrl(ATS)).toBe(false);
  });
});

describe("checkUrl", () => {
  const resp = (status: number, url: string) => ({ status, ok: status >= 200 && status < 300, url });
  // checkUrl infers fetch's full type from its default param; the stubs only
  // need { status, ok, url }, so widen them through unknown.
  const asFetch = (fn: unknown) => fn as typeof fetch;

  it("HEAD-checks and classifies", async () => {
    const fetchImpl = asFetch(async () => resp(404, ATS));
    expect(await checkUrl(ATS, { fetchImpl })).toEqual({ verdict: "dead", reason: "http-404" });
  });

  it("falls back to GET on 405", async () => {
    const calls: string[] = [];
    const fetchImpl = asFetch(async (_url: string, opts: { method: string }) => {
      calls.push(opts.method);
      return opts.method === "HEAD" ? resp(405, ATS) : resp(200, ATS);
    });
    expect((await checkUrl(ATS, { fetchImpl })).verdict).toBe("live");
    expect(calls).toEqual(["HEAD", "GET"]);
  });

  it("never fetches LinkedIn at all", async () => {
    let fetched = 0;
    const fetchImpl = asFetch(async () => {
      fetched++;
      return resp(200, "x");
    });
    const r = await checkUrl("https://linkedin.com/jobs/view/123456789", { fetchImpl });
    expect(r.reason).toBe("linkedin-not-checkable");
    expect(fetched).toBe(0);
  });

  it("network errors are unverified", async () => {
    const fetchImpl = asFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await checkUrl(ATS, { fetchImpl })).toEqual({ verdict: "unverified", reason: "fetch-error" });
  });
});

describe("BOARD_KINDS", () => {
  it("stays the exact board-diff set — the sweep covers its complement", () => {
    expect(BOARD_KINDS).toEqual(["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "teamtailor"]);
  });
});
