// Pins the dev-only verification fixture (lib/devFixture.ts). Two properties matter:
// it is OFF unless the E2E bypass is on (it must never reach a real user), and its
// synthetic data is deterministic and clearly labelled, so a walk that screenshots
// /today twice gets the same page and nobody mistakes a fixture score for a match.
import { describe, it, expect } from "vitest";
import {
  DEV_FIXTURE,
  DEV_FIXTURE_REASON,
  devFixtureBatch,
  devFixtureScore,
  devFixtureScores,
} from "@/lib/devFixture";

describe("dev fixture gate", () => {
  it("is off without VITE_E2E_BYPASS_AUTH, even in a dev/test environment", () => {
    expect(DEV_FIXTURE).toBe(false);
  });
});

describe("devFixtureScore", () => {
  it("is deterministic per job id", () => {
    expect(devFixtureScore("job-a")).toBe(devFixtureScore("job-a"));
    expect(devFixtureScore("job-a")).not.toBe(devFixtureScore("job-b"));
  });

  it("stays inside the rubric's 4.0–9.5 band", () => {
    for (const id of ["a", "b", "c", "role-42", "9f7c1e2a-0000-4000-8000-000000000001"]) {
      const s = devFixtureScore(id);
      expect(s).toBeGreaterThanOrEqual(4);
      expect(s).toBeLessThanOrEqual(9.5);
      expect(Number.isInteger(s * 10)).toBe(true);
    }
  });
});

describe("devFixtureScores", () => {
  it("fills only unscored rows and says the score is synthetic", () => {
    // has_jd carried explicitly: the readability gate fails closed since #149, so
    // a row with no flag is a role with no description and never gets a score,
    // synthetic or paid.
    const out = devFixtureScores([
      { id: "real", score: 8.1, reason: "A real reason", has_jd: true },
      { id: "empty", score: null, reason: null, has_jd: true },
    ]);
    expect(out[0]).toEqual({ id: "real", score: 8.1, reason: "A real reason", has_jd: true });
    expect(out[1].score).toBe(devFixtureScore("empty"));
    expect(out[1].reason).toBe(DEV_FIXTURE_REASON);
  });
});

describe("devFixtureBatch", () => {
  const jobs = [
    { id: "a", url: "https://x.test/a", score: 5 },
    { id: "b", url: "https://x.test/b", score: 9 },
    { id: "c", url: "https://x.test/c", score: 7 },
  ];

  it("ranks best-first and carries the current rubric so the overlay applies", () => {
    const batch = devFixtureBatch(jobs, "2026-07-26", "v9", 2);
    expect(batch.map((r) => r.job_url)).toEqual(["https://x.test/b", "https://x.test/c"]);
    expect(batch.map((r) => r.rank)).toEqual([1, 2]);
    expect(batch[0].batch_date).toBe("2026-07-26");
    expect(batch[0].rubric_version).toBe("v9");
  });

  it("does not mutate the pool it ranks", () => {
    const before = jobs.map((j) => j.id);
    devFixtureBatch(jobs, "2026-07-26", "v9");
    expect(jobs.map((j) => j.id)).toEqual(before);
  });
});
