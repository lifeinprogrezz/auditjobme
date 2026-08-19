// Pins the CV-churn cost controls (#123).
//
// Before this, ANY CV edit ran `delete from scores where user_id = ...` and the
// worker re-bought the user's whole slice: ~$3.69 a time, measured. Seven edits
// in a month cost ~13x that user's normal spend, and CV-tweaking is the core
// loop of an active job seeker — so the most engaged user was the most
// expensive one, which is backwards. It was also a UX bug: the map went blank
// after every edit until the worker drained.
import { describe, expect, it } from "vitest";
import {
  STALE_DEBOUNCE_MS,
  STALE_REFRESH_BUDGET,
  isStale,
  isDebounced,
  selectStaleRefresh,
  shouldRefreshStale,
  STALE_REFRESH_INTERVAL_MS,
} from "@/lib/scoreRefresh";

const row = (job_id: string, score: number | null, cv_hash: string | null) => ({ job_id, score, cv_hash });

describe("isStale", () => {
  it("is stale when the score was computed from a different CV", () => {
    expect(isStale(row("a", 4.2, "oldhash"), "newhash")).toBe(true);
  });

  it("is fresh when the CV has not moved", () => {
    expect(isStale(row("a", 4.2, "same"), "same")).toBe(false);
  });

  it("treats a score with no recorded CV as fresh, not stale", () => {
    // Rows written before this feature carry no cv_hash. Calling them stale
    // would re-buy every score every user already has, the exact bill this
    // change exists to avoid.
    expect(isStale(row("a", 4.2, null), "newhash")).toBe(false);
  });
});

describe("isDebounced", () => {
  it("holds off while the user is still editing", () => {
    const now = 1_000_000;
    expect(isDebounced(new Date(now - 1000).toISOString(), now)).toBe(true);
  });

  it("releases once edits go quiet", () => {
    const now = 1_000_000;
    expect(isDebounced(new Date(now - STALE_DEBOUNCE_MS - 1).toISOString(), now)).toBe(false);
  });

  it("never holds off when no CV change was recorded", () => {
    expect(isDebounced(null, 1_000_000)).toBe(false);
    expect(isDebounced(undefined, 1_000_000)).toBe(false);
  });

  it("does not hold off on an unparseable timestamp, rather than stalling forever", () => {
    expect(isDebounced("not a date", 1_000_000)).toBe(false);
  });
});

describe("selectStaleRefresh", () => {
  const scored = [
    row("low", 1.2, "old"),
    row("top", 4.8, "old"),
    row("mid", 3.1, "old"),
    row("fresh", 4.9, "new"),
    row("unscored", null, "old"),
  ];

  it("re-buys the best roles first, because that is what the user looks at", () => {
    const picked = selectStaleRefresh(scored, "new", 2);
    expect(picked).toEqual(["top", "mid"]);
  });

  it("never re-buys a score that is already on the current CV", () => {
    expect(selectStaleRefresh(scored, "new", 10)).not.toContain("fresh");
  });

  it("caps each pass, so the long tail is paced instead of bought in one go", () => {
    const many = Array.from({ length: STALE_REFRESH_BUDGET + 25 }, (_, i) =>
      row(`j${i}`, 5 - i / 1000, "old"),
    );
    expect(selectStaleRefresh(many, "new", STALE_REFRESH_BUDGET)).toHaveLength(STALE_REFRESH_BUDGET);
  });

  it("returns nothing when every score already matches the CV on file", () => {
    // The ordinary day: nobody edited anything, so no refresh is bought. The
    // earlier version of this test passed a hash that made an existing row look
    // NEWER than the current CV, which cannot happen and quietly asserted the
    // opposite of its own name.
    const allCurrent = [row("a", 4.2, "cv1"), row("b", 3.0, "cv1"), row("c", null, "cv1")];
    expect(selectStaleRefresh(allCurrent, "cv1", 10)).toEqual([]);
  });

  it("orders deterministically when scores tie, so two runs pick the same rows", () => {
    const tied = [row("b", 3, "old"), row("a", 3, "old"), row("c", 3, "old")];
    expect(selectStaleRefresh(tied, "new", 2)).toEqual(selectStaleRefresh([...tied].reverse(), "new", 2));
  });
});

describe("pacing across passes, not just within one", () => {
  // The budget alone is not pacing. The worker fires every 10 minutes, so a
  // 40-per-pass budget would refresh 5,760 roles a day and buy the entire tail
  // within hours — the opposite of the intent. The interval is what actually
  // spreads the cost, and it is the reason a user who edits and leaves never
  // pays for their long tail.
  it("allows a refresh when the user has never had one", () => {
    expect(shouldRefreshStale(null, 1_000_000)).toBe(true);
  });

  it("blocks a second refresh inside the interval", () => {
    const now = 1_000_000_000;
    expect(shouldRefreshStale(new Date(now - 60_000).toISOString(), now)).toBe(false);
  });

  it("allows the next batch once the interval has passed", () => {
    const now = 1_000_000_000;
    expect(shouldRefreshStale(new Date(now - STALE_REFRESH_INTERVAL_MS - 1).toISOString(), now)).toBe(true);
  });

  it("bounds the daily spend to something a launch budget can absorb", () => {
    // The property that matters, expressed as arithmetic rather than a promise.
    const batchesPerDay = (24 * 60 * 60 * 1000) / STALE_REFRESH_INTERVAL_MS;
    const rolesPerDay = batchesPerDay * STALE_REFRESH_BUDGET;
    expect(rolesPerDay).toBeLessThanOrEqual(200);
  });
});
