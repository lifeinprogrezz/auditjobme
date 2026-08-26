import { describe, it, expect, vi, afterEach } from "vitest";
import { artifactCarriesHasJd, dataplaneUrl, fetchDataplane, isDataplane } from "@/lib/dataplane";

const VALID = {
  version: 1,
  generated_at: "2026-07-11T05:30:00.000Z",
  counts: { jobs: 1, companies: 1, offices: 0 },
  jobs: [{ id: "a", company: "Alpha", title: "PM", url: "https://a", has_jd: true }],
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

  // The GEO prerender (vite.config.ts) asks this same guard at build time, and it
  // never reads has_jd. So the column check belongs to fetchDataplane, not here:
  // failing it here would drop every city page over a scoring column.
  it("does not judge the column set: that is fetchDataplane's job", () => {
    expect(isDataplane({ ...VALID, jobs: [{ id: "a", company: "Alpha", title: "PM" }] })).toBe(true);
  });
});

// Issue #149 item A8. The readability gate fails closed now, so an artifact built
// before has_jd joined JOBS_COLUMNS would blank every score and every count for
// the app. Wrong column set, not stale data.
describe("artifactCarriesHasJd", () => {
  it("accepts a null or false flag: the column is there, that row has no description", () => {
    expect(artifactCarriesHasJd([{ id: "a", has_jd: null }])).toBe(true);
    expect(artifactCarriesHasJd([{ id: "a", has_jd: false }])).toBe(true);
  });

  it("refuses rows that predate the column", () => {
    expect(artifactCarriesHasJd([{ id: "a", company: "Alpha" }])).toBe(false);
  });

  it("accepts an empty job list, which cannot disagree with anything", () => {
    expect(artifactCarriesHasJd([])).toBe(true);
  });
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

  it("returns null for an artifact built before has_jd, so the app reads live", async () => {
    const old = { ...VALID, jobs: [{ id: "a", company: "Alpha", title: "PM", url: "https://a" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => old }));
    expect(await fetchDataplane("https://x.supabase.co")).toBeNull();
  });
});
