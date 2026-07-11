import { describe, it, expect, vi, afterEach } from "vitest";
import { dataplaneUrl, fetchDataplane, isDataplane } from "@/lib/dataplane";

const VALID = {
  version: 1,
  generated_at: "2026-07-11T05:30:00.000Z",
  counts: { jobs: 1, companies: 1, offices: 0 },
  jobs: [{ id: "a", company: "Alpha", title: "PM", url: "https://a" }],
  companies: [{ slug: "alpha" }],
  offices: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("dataplaneUrl", () => {
  it("builds the public storage URL, tolerating a trailing slash", () => {
    expect(dataplaneUrl("https://x.supabase.co/")).toBe(
      "https://x.supabase.co/storage/v1/object/public/dataplane/dataplane.json",
    );
  });
});

describe("isDataplane", () => {
  it("accepts the artifact shape", () => {
    expect(isDataplane(VALID)).toBe(true);
  });
  it.each([null, "x", {}, { ...VALID, jobs: "nope" }, { ...VALID, version: "1" }])(
    "rejects malformed input %#",
    (bad) => {
      expect(isDataplane(bad)).toBe(false);
    },
  );
});

describe("fetchDataplane — null on ANY failure so the caller falls back to live reads", () => {
  it("returns the artifact on a healthy fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => VALID }));
    expect(await fetchDataplane("https://x.supabase.co")).toEqual(VALID);
  });
  it("returns null on non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await fetchDataplane("https://x.supabase.co")).toBeNull();
  });
  it("returns null on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchDataplane("https://x.supabase.co")).toBeNull();
  });
  it("returns null on malformed body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nope: 1 }) }));
    expect(await fetchDataplane("https://x.supabase.co")).toBeNull();
  });
});
