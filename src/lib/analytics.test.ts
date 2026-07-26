import { describe, it, expect, vi, afterEach } from "vitest";

// Each test re-mocks "posthog-js" and re-imports the module fresh (resetModules
// clears analytics.ts's cached `posthogPromise`), so one test's mock never
// leaks into the next — the same isolation risk a shared module-level cache
// would otherwise create.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("posthog-js");
});

describe("track", () => {
  it("never imports posthog-js, and never calls capture, when no key is configured", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    const capture = vi.fn();
    vi.doMock("posthog-js", () => ({ default: { capture } }));
    const { track } = await import("./analytics");

    track("cv_uploaded", { word_count: 420 });
    await new Promise((r) => setTimeout(r, 0));

    expect(capture).not.toHaveBeenCalled();
  });

  it("fires the exact event name and properties through, untouched, when a key is configured", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_123");
    const capture = vi.fn();
    vi.doMock("posthog-js", () => ({ default: { capture } }));
    const { track } = await import("./analytics");

    track("role_detail_opened", { scored: true, score: 4.2 });
    await new Promise((r) => setTimeout(r, 0));

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("role_detail_opened", { scored: true, score: 4.2 });
  });

  it("fires an event with no properties as undefined, not a fabricated payload", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_123");
    const capture = vi.fn();
    vi.doMock("posthog-js", () => ({ default: { capture } }));
    const { track } = await import("./analytics");

    track("cv_submitted");
    await new Promise((r) => setTimeout(r, 0));

    expect(capture).toHaveBeenCalledWith("cv_submitted", undefined);
  });

  it("never throws when the posthog-js module fails to load", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_123");
    vi.doMock("posthog-js", () => {
      throw new Error("network error");
    });
    const { track } = await import("./analytics");

    expect(() => track("cv_submitted")).not.toThrow();
    // Let the rejected dynamic import settle so an unhandled-rejection isn't
    // the thing that quietly fails this test instead.
    await new Promise((r) => setTimeout(r, 0));
  });

  it("never throws when posthog-js itself throws while capturing", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_123");
    const capture = vi.fn(() => {
      throw new Error("boom");
    });
    vi.doMock("posthog-js", () => ({ default: { capture } }));
    const { track } = await import("./analytics");

    expect(() => track("cv_submitted")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(capture).toHaveBeenCalled();
  });
});
