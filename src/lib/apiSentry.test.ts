import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ErrorEvent as SentryErrorEvent } from "@sentry/node";

// Issue #145: the Vercel functions report to Sentry. These tests pin the pure
// parts of src/lib/apiSentry.ts against a mocked @sentry/node — no DSN, no wire.

const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setContext: vi.fn(),
  flush: vi.fn(async () => true),
  withIsolationScope: vi.fn(async (cb: (scope: { setTag: (k: string, v: string) => void }) => unknown) =>
    cb({ setTag: sentryMock.setTag }),
  ),
  setTag: vi.fn(),
}));

vi.mock("@sentry/node", () => sentryMock);

type Res = { status: (code: number) => Res; json: (body: unknown) => void };

function fakeRes() {
  const calls: { status?: number; body?: unknown } = {};
  const res: Res = {
    status(code) {
      calls.status = code;
      return res;
    },
    json(body) {
      calls.body = body;
    },
  };
  return { res, calls };
}

// Assembled at runtime so a DSN-shaped literal never lands in the repo.
const FAKE_DSN = ["https://", "examplepublickey", "@o0.ingest.sentry.io/0"].join("");

async function loadFresh() {
  vi.resetModules();
  return import("./apiSentry");
}

describe("withSentry", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SENTRY_DSN;
    delete process.env.VITE_SENTRY_DSN;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("is a no-op without a DSN: handler runs, nothing is initialised, captured or flushed", async () => {
    const { withSentry } = await loadFresh();
    const handler = vi.fn(async (_req: unknown, res: Res) => {
      res.status(200).json({ ok: true });
    });
    const { res, calls } = fakeRes();

    await withSentry("nightly", handler)({ headers: {} }, res);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(calls).toEqual({ status: 200, body: { ok: true } });
    expect(sentryMock.init).not.toHaveBeenCalled();
    expect(sentryMock.flush).not.toHaveBeenCalled();
  });

  it("initialises once per process from SENTRY_DSN and flushes after a successful run", async () => {
    process.env.SENTRY_DSN = FAKE_DSN;
    const { withSentry } = await loadFresh();
    const wrapped = withSentry("nightly", async (_req: unknown, res: Res) => {
      res.status(207).json({ ok: true });
    });

    const first = fakeRes();
    await wrapped({ headers: {} }, first.res);
    const second = fakeRes();
    await wrapped({ headers: {} }, second.res);

    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    expect(sentryMock.init.mock.calls[0][0]).toMatchObject({ dsn: FAKE_DSN, tracesSampleRate: 0 });
    expect(first.calls.status).toBe(207);
    expect(second.calls.status).toBe(207);
    expect(sentryMock.setTag).toHaveBeenCalledWith("function", "nightly");
    expect(sentryMock.flush).toHaveBeenCalledTimes(2);
    expect(sentryMock.flush).toHaveBeenCalledWith(2000);
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });

  it("falls back to VITE_SENTRY_DSN when SENTRY_DSN is unset", async () => {
    process.env.VITE_SENTRY_DSN = FAKE_DSN;
    const { withSentry } = await loadFresh();
    await withSentry("spend-alert", async () => {})({ headers: {} }, fakeRes().res);
    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    expect(sentryMock.init.mock.calls[0][0]).toMatchObject({ dsn: FAKE_DSN });
  });

  it("captures a thrown error with the function tag, flushes, and rethrows unchanged", async () => {
    process.env.SENTRY_DSN = FAKE_DSN;
    const { withSentry } = await loadFresh();
    const boom = new Error("profiles read failed");
    const wrapped = withSentry("score-backlog", async () => {
      throw boom;
    });

    await expect(wrapped({ headers: {} }, fakeRes().res)).rejects.toBe(boom);

    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException.mock.calls[0][0]).toBe(boom);
    expect(sentryMock.captureException.mock.calls[0][1]).toMatchObject({ tags: { function: "score-backlog" } });
    // Flushed AFTER capture, or the event dies with the invocation.
    const captureOrder = sentryMock.captureException.mock.invocationCallOrder[0];
    const flushOrder = sentryMock.flush.mock.invocationCallOrder[0];
    expect(flushOrder).toBeGreaterThan(captureOrder);
  });

  it("a flush failure never masks the handler's own outcome", async () => {
    process.env.SENTRY_DSN = FAKE_DSN;
    sentryMock.flush.mockRejectedValueOnce(new Error("transport down"));
    const { withSentry } = await loadFresh();
    const { res, calls } = fakeRes();
    await withSentry("nightly", async (_req: unknown, r: Res) => {
      r.status(200).json({ ok: true });
    })({ headers: {} }, res);
    expect(calls.status).toBe(200);
  });
});

describe("reportApiError + setRunSummary", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SENTRY_DSN;
    delete process.env.VITE_SENTRY_DSN;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("are no-ops without a DSN", async () => {
    const { reportApiError, setRunSummary } = await loadFresh();
    reportApiError("[nightly] all users failed", { failed: 3 });
    setRunSummary({ users: 3 });
    expect(sentryMock.captureMessage).not.toHaveBeenCalled();
    expect(sentryMock.setContext).not.toHaveBeenCalled();
  });

  it("send an error-level message with extras, and the run summary as a context", async () => {
    process.env.SENTRY_DSN = FAKE_DSN;
    const { initApiSentry, reportApiError, setRunSummary } = await loadFresh();
    initApiSentry("nightly");
    reportApiError("[nightly] all users failed", { failed: 3 });
    setRunSummary({ users: 3, failed: 3 });
    expect(sentryMock.captureMessage).toHaveBeenCalledWith("[nightly] all users failed", {
      level: "error",
      extra: { failed: 3 },
    });
    expect(sentryMock.setContext).toHaveBeenCalledWith("run", { users: 3, failed: 3 });
  });
});

describe("server-side sanitize rule: ids and counts only", () => {
  it("scrubContent drops CV text, JD bodies, email bodies and addresses; keeps ids and counts", async () => {
    const { scrubContent } = await loadFresh();
    const out = scrubContent({
      users: 3,
      userId: "5e1f8c2a-0000-4000-8000-000000000001",
      cv_text: "Rober Quintero, product manager...",
      jd_text: "We are hiring a PM...",
      cvText: "again",
      subject: "Your application to Acme",
      html: "<p>hi</p>",
      text: "plain body",
      to: "someone@example.com",
      note: "contact someone@example.com for details",
      nested: { jdText: "deep", count: 2 },
      list: [{ email: "a@b.co" }, "ok"],
    });
    const wire = JSON.stringify(out);
    expect(wire).not.toContain("Rober");
    expect(wire).not.toContain("hiring");
    expect(wire).not.toContain("again");
    expect(wire).not.toContain("Acme");
    expect(wire).not.toContain("<p>");
    expect(wire).not.toContain("plain body");
    expect(wire).not.toContain("@example.com");
    expect(wire).not.toContain("a@b.co");
    expect(wire).not.toContain("deep");
    expect(out).toMatchObject({
      users: 3,
      userId: "5e1f8c2a-0000-4000-8000-000000000001",
      note: "contact <email> for details",
      nested: { count: 2 },
      list: [{ email: "<redacted>" }, "ok"],
    });
  });

  it("the beforeSend passed to Sentry.init applies both the shared URL rule and the content rule", async () => {
    process.env.SENTRY_DSN = FAKE_DSN;
    const { initApiSentry } = await loadFresh();
    initApiSentry("nightly");
    const beforeSend = sentryMock.init.mock.calls[0][0].beforeSend as (e: SentryErrorEvent) => SentryErrorEvent | null;
    const event = beforeSend({
      type: undefined,
      message: "Resend 422 for someone@example.com",
      extra: { cv_text: "secret cv", attemptedUrl: "https://northgoing.com/#access_token=abc", users: 2 },
      contexts: { run: { jd_text: "secret jd", matches: 4 } },
      exception: { values: [{ type: "Error", value: "user someone@example.com failed" }] },
    } as SentryErrorEvent);
    const wire = JSON.stringify(event);
    expect(wire).not.toContain("secret");
    expect(wire).not.toContain("@example.com");
    expect(wire).not.toContain("access_token");
    expect(event?.extra?.users).toBe(2);
    expect(event?.contexts?.run?.matches).toBe(4);
    delete process.env.SENTRY_DSN;
  });
});
