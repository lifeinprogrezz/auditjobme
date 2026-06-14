import { describe, it, expect, beforeEach, vi } from "vitest";

// Regression guard for the usage-meter attribution (issue #9): the anthropic-proxy
// meters each LLM call by the `kind` the client sends, defaulting anything missing
// to 'score'. So a caller that forgets `kind` silently mis-attributes its spend.
// These tests pin the two non-tailor callers to the right kind.
//
// vi.hoisted lets the hoisted vi.mock factory share invokeMock with the score test.
// The same mocked client serves both files: score.ts uses functions.invoke,
// audit/api.js uses auth.getSession.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: invokeMock },
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: "test-token" } } }),
    },
  },
}));

import { scoreJob } from "@/lib/score";
import { callClaude } from "@/components/audit/api";

const PROFILE = {
  target_seniority: "pm",
  target_cities: ["London"],
  open_to_remote: true,
  citizenship: "ES",
  eu_work_authorized: true,
  languages: ["English"],
  cv_text: "x",
};
const JOB = {
  id: "1",
  company: "Acme",
  title: "Product Manager",
  location: "London",
  remote: true,
  seniority: "pm",
  jd_text: "build things",
};

function stubFetch() {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ content: [{ text: "ok" }] }) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("usage-meter kind attribution (#9)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("scoreJob attributes its spend as kind 'score'", async () => {
    invokeMock.mockResolvedValue({
      data: { content: [{ text: '{"score":4,"reason":"ok"}' }] },
      error: null,
    });
    await scoreJob(PROFILE, JOB);
    expect(invokeMock).toHaveBeenCalledWith(
      "anthropic-proxy",
      expect.objectContaining({ body: expect.objectContaining({ kind: "score" }) }),
    );
  });

  it("audit callClaude attributes its spend as kind 'audit' by default", async () => {
    const fetchMock = stubFetch();
    await callClaude([{ role: "user", content: "hi" }]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.kind).toBe("audit");
  });

  it("audit callClaude lets opts.kind override the attribution", async () => {
    const fetchMock = stubFetch();
    await callClaude([{ role: "user", content: "hi" }], { kind: "score" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.kind).toBe("score");
  });
});
