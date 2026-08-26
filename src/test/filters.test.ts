import { describe, it, expect, beforeEach } from "vitest";
import { sizeBand, sizeBandOrder, filterJobs, freshnessCutoffMs, requiredLanguages, roleFamily, roleSeenMs, workplaceOf, EMPTY_FILTERS, FRESHNESS_WINDOWS, readStoredMine, writeStoredMine, shouldDefaultMineOn, settleMineDefault, shouldForceMineOff, railHeading, type RoleJob } from "@/lib/roles";

const base: RoleJob = {
  id: "1",
  company: "Acme",
  title: "Product Manager",
  url: "u",
  location: "Berlin",
  remote: false,
  source: null,
  seniority: "pm",
  posted_at: null,
  score: null,
  reason: null,
  city: "Berlin",
  lngLat: null,
  domain: null,
};
const mk = (o: Partial<RoleJob>): RoleJob => ({ ...base, ...o });

describe("sizeBand", () => {
  it("bands every canonical bucket the database can now hold (issue #68 item 6)", () => {
    expect(sizeBand("1-10")).toBe("1–10");
    expect(sizeBand("11-50")).toBe("11–50");
    expect(sizeBand("51-200")).toBe("51–200");
    expect(sizeBand("201-500")).toBe("201–500");
    expect(sizeBand("501-2000")).toBe("500–2k");
    expect(sizeBand("2001+")).toBe("2k+");
  });
  it("still maps the legacy schemes, for artifacts built before the migration", () => {
    expect(sizeBand("1-10")).toBe("1–10");
    expect(sizeBand("<10")).toBe("1–10");
    expect(sizeBand("10-30")).toBe("11–50");
    expect(sizeBand("11-50")).toBe("11–50");
    expect(sizeBand("30-100")).toBe("51–200");
    expect(sizeBand("51-200")).toBe("51–200");
    expect(sizeBand("100-500")).toBe("201–500");
    expect(sizeBand("201-500")).toBe("201–500");
    expect(sizeBand("500+")).toBe("500–2k");
    expect(sizeBand("500-2k")).toBe("500–2k");
    expect(sizeBand("2k+")).toBe("2k+");
  });
  it("returns null for unknown / empty (never fabricates a band)", () => {
    expect(sizeBand(null)).toBeNull();
    expect(sizeBand(undefined)).toBeNull();
    expect(sizeBand("")).toBeNull();
    expect(sizeBand("banana")).toBeNull();
  });
  it("orders bands small→large, 99 for unknown", () => {
    expect(sizeBandOrder("1–10")).toBe(0);
    expect(sizeBandOrder("2k+")).toBe(5);
    expect(sizeBandOrder("nope")).toBe(99);
    expect(sizeBandOrder("51–200")).toBeLessThan(sizeBandOrder("500–2k"));
  });
});

describe("filterJobs", () => {
  const jobs = [
    mk({ id: "a", company: "Acme", city: "Berlin", sector: "Fintech", headcount: "51-200" }),
    mk({ id: "b", company: "Beta", city: "London", sector: "Healthtech", headcount: "2k+" }),
    mk({ id: "c", company: "Gamma", city: null, sector: null, headcount: null }),
  ];

  it("empty filters return everything — missing-data rows included", () => {
    expect(filterJobs(jobs, EMPTY_FILTERS)).toHaveLength(3);
  });
  it("city filter keeps matches and drops null-city rows", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, cities: ["Berlin"] }).map((j) => j.id)).toEqual(["a"]);
  });
  it("sector filter drops null-sector rows", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, sectors: ["Healthtech"] }).map((j) => j.id)).toEqual(["b"]);
  });
  it("size filter matches by canonical band and drops null-headcount rows", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, sizes: ["51–200"] }).map((j) => j.id)).toEqual(["a"]);
  });
  it("dimensions are AND-across (city AND sector must both hold)", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, cities: ["Berlin"], sectors: ["Healthtech"] })).toHaveLength(0);
  });
  it("free-text query matches company + title only, NOT city", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, query: "beta" }).map((j) => j.id)).toEqual(["b"]);
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, query: "berlin" })).toHaveLength(0);
  });
});

describe("workplaceOf", () => {
  it("workplace column wins over extraction and the remote flag", () => {
    expect(workplaceOf(mk({ workplace: "hybrid", remote: true }))).toBe("hybrid");
    expect(workplaceOf(mk({ workplace: "onsite", extraction: { remote_policy: "remote" } }))).toBe("onsite");
  });
  it("falls back to extraction.remote_policy, then the remote flag, then null", () => {
    expect(workplaceOf(mk({ extraction: { remote_policy: "hybrid" } }))).toBe("hybrid");
    expect(workplaceOf(mk({ remote: true }))).toBe("remote");
    expect(workplaceOf(mk({}))).toBeNull();
  });
});

describe("filterJobs — Workplace discovery facet", () => {
  const jobs = [
    mk({ id: "r", workplace: "remote" }),
    mk({ id: "h", extraction: { remote_policy: "hybrid" } }),
    mk({ id: "o", workplace: "onsite" }),
    mk({ id: "u" }), // unknown
  ];
  it("no selection → everything shows, unknowns included", () => {
    expect(filterJobs(jobs, EMPTY_FILTERS)).toHaveLength(4);
  });
  it("selecting a mode shows ONLY known matches (unknown hides — discovery semantics)", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, workplaces: ["hybrid"] }).map((j) => j.id)).toEqual(["h"]);
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, workplaces: ["remote", "onsite"] }).map((j) => j.id)).toEqual(["r", "o"]);
  });
  it("fixtures without a workplaces key still filter (optional field)", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, cities: ["Berlin"] })).toHaveLength(4);
  });
});

describe("roleFamily", () => {
  it("reads an unlabelled row as 'other', NOT as Product (issue #70)", () => {
    // A null role_family is structural, not backfill lag: classifyRoleFamily
    // returns null for the deferred verticals, so every live null row is a UX
    // seat. Calling those Product mislabelled them in the facet.
    expect(roleFamily(mk({}))).toBe("other");
    expect(roleFamily(mk({ role_family: null }))).toBe("other");
  });
  it("a written role_family wins over the fallback", () => {
    expect(roleFamily(mk({ role_family: "engineering" }))).toBe("engineering");
  });
});

describe("filterJobs — roles facet", () => {
  const jobs = [mk({ id: "a" }), mk({ id: "b", role_family: "engineering" })];
  it("empty selection shows the full catalog", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, roles: [] })).toHaveLength(2);
  });
  it("selecting Other matches the unlabelled rows", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, roles: ["other"] }).map((j) => j.id)).toEqual(["a"]);
  });
  it("compares the stored VALUE, not the label the chip shows (issue #70)", () => {
    // The headbar chip reads "Engineering"; the filter still matches "engineering".
    // Splitting value from label is what let the chips stop shouting in lowercase.
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, roles: ["engineering"] }).map((j) => j.id)).toEqual(["b"]);
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, roles: ["Engineering"] })).toHaveLength(0);
  });
  it("selecting a written family matches only it (OR-within)", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, roles: ["engineering"] }).map((j) => j.id)).toEqual(["b"]);
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, roles: ["engineering", "other"] })).toHaveLength(2);
  });
  it("ANDs across facets (roles + cities)", () => {
    const mix = [mk({ id: "a", city: "Berlin" }), mk({ id: "b", city: "Paris", role_family: "engineering" })];
    expect(filterJobs(mix, { ...EMPTY_FILTERS, roles: ["engineering"], cities: ["Berlin"] })).toHaveLength(0);
  });
  it("fixtures without a roles key still filter (optional field)", () => {
    expect(filterJobs(jobs, EMPTY_FILTERS)).toHaveLength(2);
  });
});

describe("requiredLanguages", () => {
  it("drops English (implicit) + blanks, keeps real non-English requirements", () => {
    expect(requiredLanguages(mk({ extraction: { languages_required: ["German", "English", " "] } }))).toEqual(["German"]);
    expect(requiredLanguages(mk({ extraction: { languages_required: ["English"] } }))).toEqual([]);
    expect(requiredLanguages(mk({ extraction: null }))).toEqual([]);
    expect(requiredLanguages(mk({}))).toEqual([]);
  });
});

describe("filterJobs — Language discovery facet", () => {
  const jobs = [
    mk({ id: "en", extraction: null }), // English-only, no wall
    mk({ id: "de", extraction: { languages_required: ["German"] } }),
    mk({ id: "deen", extraction: { languages_required: ["German", "English"] } }), // English implicit
    mk({ id: "denl", extraction: { languages_required: ["German", "Dutch"] } }),
    mk({ id: "fr", extraction: { languages_required: ["French"] } }),
  ];

  it("no language selected → everything shows (fail-open)", () => {
    expect(filterJobs(jobs, EMPTY_FILTERS)).toHaveLength(5);
  });
  it("selecting German narrows to ONLY roles that wall on German (English-only hidden)", () => {
    const got = filterJobs(jobs, { ...EMPTY_FILTERS, languages: ["German"] }).map((j) => j.id);
    expect(got).toEqual(["de", "deen", "denl"]); // every German-walled role, and only those
    expect(got).not.toContain("en"); // no wall → hidden while a language is selected
    expect(got).not.toContain("fr"); // French wall, German not among its languages
  });
  it("multi-select is a union (German OR French)", () => {
    const got = filterJobs(jobs, { ...EMPTY_FILTERS, languages: ["German", "French"] }).map((j) => j.id);
    expect(got).toEqual(["de", "deen", "denl", "fr"]); // any role walling on German or French
  });
});

// ── Issue #73 slice 3: the Freshness facet ────────────────────────────────────
// FILTER ONLY. We measured age against 10,921 rows of the personal engine's golden
// scoring data on 2026-07-26: freshness does NOT predict match quality (the learned
// weights are non-monotonic), so it must never tilt the ranking — only the view.
const DAY = 86_400_000;
const NOW = Date.parse("2026-07-26T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

describe("roleSeenMs", () => {
  it("prefers first_seen_at, falls back to posted_at, then unknown", () => {
    expect(roleSeenMs({ first_seen_at: daysAgo(2), posted_at: daysAgo(90) })).toBe(Date.parse(daysAgo(2)));
    expect(roleSeenMs({ first_seen_at: null, posted_at: daysAgo(5) })).toBe(Date.parse(daysAgo(5)));
    expect(roleSeenMs({ first_seen_at: null, posted_at: null })).toBe(0);
  });
});

describe("freshnessCutoffMs", () => {
  it("returns null when nothing is selected (no age filter at all)", () => {
    expect(freshnessCutoffMs([], NOW)).toBeNull();
    expect(freshnessCutoffMs(undefined, NOW)).toBeNull();
    expect(freshnessCutoffMs(["nonsense"], NOW)).toBeNull();
  });
  it("a multi-select is a UNION — the widest selected window wins", () => {
    expect(freshnessCutoffMs(["7"], NOW)).toBe(NOW - 7 * DAY);
    expect(freshnessCutoffMs(["7", "28"], NOW)).toBe(NOW - 28 * DAY);
  });
  it("offers exactly the 7 / 14 / 28-day ladder", () => {
    expect(FRESHNESS_WINDOWS.map((w) => w.days)).toEqual([7, 14, 28]);
  });
});

describe("filterJobs — Freshness discovery facet", () => {
  const jobs = [
    mk({ id: "fresh", first_seen_at: daysAgo(2), posted_at: null }),
    mk({ id: "mid", first_seen_at: daysAgo(10), posted_at: null }),
    mk({ id: "old", first_seen_at: daysAgo(40), posted_at: null }),
    // posted_at is nullable and first_seen_at is on every real row; this is the
    // pre-#73 dataplane-artifact shape, where the fallback carries the date.
    mk({ id: "fallback", first_seen_at: null, posted_at: daysAgo(3) }),
    mk({ id: "undated", first_seen_at: null, posted_at: null }),
  ];

  it("no window selected → everything shows, undated rows included", () => {
    expect(filterJobs(jobs, EMPTY_FILTERS, NOW)).toHaveLength(5);
  });
  it("7 days keeps only roles seen inside the window", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, freshness: ["7"] }, NOW).map((j) => j.id)).toEqual([
      "fresh",
      "fallback",
    ]);
  });
  it("28 days widens it; a 40-day-old role still fails", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, freshness: ["28"] }, NOW).map((j) => j.id)).toEqual([
      "fresh",
      "mid",
      "fallback",
    ]);
  });
  it("an UNDATED role hides while a window is active — we never fabricate it as fresh", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, freshness: ["28"] }, NOW).map((j) => j.id)).not.toContain("undated");
  });
});

// ── Issue #73 slice 5: the UK sponsor-licence facet ───────────────────────────
describe("filterJobs — UK sponsor discovery facet", () => {
  const jobs = [
    mk({ id: "lic", ukSponsorStatus: "licensed" }),
    mk({ id: "un", ukSponsorStatus: "unmatched" }),
    mk({ id: "unchecked", ukSponsorStatus: null }),
  ];

  it("no status selected → everything shows (fail-open)", () => {
    expect(filterJobs(jobs, EMPTY_FILTERS, NOW)).toHaveLength(3);
  });
  it("selecting 'licensed' keeps only companies on the Home Office register", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, sponsors: ["licensed"] }, NOW).map((j) => j.id)).toEqual(["lic"]);
  });
  it("an UNCHECKED company hides while a status is active — silence is not evidence", () => {
    const got = filterJobs(jobs, { ...EMPTY_FILTERS, sponsors: ["licensed", "unmatched"] }, NOW).map((j) => j.id);
    expect(got).toEqual(["lic", "un"]);
    expect(got).not.toContain("unchecked");
  });
});

// ── Issue #154: the "Your matches" facet ──────────────────────────────────────
describe("filterJobs — Your matches (mine) facet", () => {
  const jobs = [
    mk({ id: "scored-eligible", score: 4.2 }),
    mk({ id: "pending-eligible" }), // unscored, still in the eligible slice
    mk({ id: "outside-slice" }), // never in eligibleIds
  ];
  const eligibleIds = new Set(["scored-eligible", "pending-eligible"]);

  it("off (default) → the whole catalog, regardless of eligibility", () => {
    expect(filterJobs(jobs, EMPTY_FILTERS, Date.now(), eligibleIds)).toHaveLength(3);
  });
  it("on → only the eligible slice, scored or still pending within it", () => {
    const got = filterJobs(jobs, { ...EMPTY_FILTERS, mine: true }, Date.now(), eligibleIds).map((j) => j.id);
    expect(got).toEqual(["scored-eligible", "pending-eligible"]);
    expect(got).not.toContain("outside-slice");
  });
  it("no eligibleIds supplied → fail-safe closed (mine on, no known slice, shows nothing)", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS, mine: true })).toHaveLength(0);
  });
  it("ANDs with the other facets (mine + city)", () => {
    const mix = [
      mk({ id: "a", city: "Berlin" }),
      mk({ id: "b", city: "Paris" }),
    ];
    const ids = new Set(["a", "b"]);
    expect(
      filterJobs(mix, { ...EMPTY_FILTERS, mine: true, cities: ["Berlin"] }, Date.now(), ids).map((j) => j.id),
    ).toEqual(["a"]);
  });
  it("fixtures without a mine key still filter (optional field)", () => {
    expect(filterJobs(jobs, { ...EMPTY_FILTERS }, Date.now(), eligibleIds)).toHaveLength(3);
  });
});

describe("shouldDefaultMineOn (issue #154 default-on rule)", () => {
  const base = { signedIn: true, hasCv: true, hasScore: true, stored: null as boolean | null };

  it("defaults ON once a signed-in user with a CV has at least one landed score", () => {
    expect(shouldDefaultMineOn(base)).toBe(true);
  });
  it("stays OFF while no score has landed yet, even signed in with a CV", () => {
    expect(shouldDefaultMineOn({ ...base, hasScore: false })).toBe(false);
  });
  it("stays OFF for a logged-out visitor", () => {
    expect(shouldDefaultMineOn({ ...base, signedIn: false })).toBe(false);
  });
  it("stays OFF for a signed-in visitor with no CV on file", () => {
    expect(shouldDefaultMineOn({ ...base, hasCv: false })).toBe(false);
  });
  it("a stored explicit choice wins for a signed-in, scored user, either way", () => {
    expect(shouldDefaultMineOn({ ...base, hasScore: false, stored: true })).toBe(true);
    expect(shouldDefaultMineOn({ ...base, stored: false })).toBe(false);
  });
  // Fix round 1, blocker 2: the logged-out/no-CV rule overrides ANY stored value —
  // a stored "1" from an earlier scored session must not survive a same-browser
  // sign-out (SPA, no reload) or follow the browser into an anonymous visit.
  it("ignores a stored choice for a logged-out visitor", () => {
    expect(shouldDefaultMineOn({ ...base, signedIn: false, stored: true })).toBe(false);
  });
  it("ignores a stored choice for a signed-in visitor with no CV", () => {
    expect(shouldDefaultMineOn({ ...base, hasCv: false, stored: true })).toBe(false);
  });
});

describe("settleMineDefault (issue #154 fix round 1, blocker 1: don't settle before auth/profile land)", () => {
  const ready = {
    authLoading: false,
    profileChecked: true,
    signedIn: true,
    hasCv: true,
    hasScore: true,
    stored: null as boolean | null,
  };

  it("waits while auth is still loading, even with nothing stored", () => {
    expect(settleMineDefault({ ...ready, authLoading: true })).toBe("wait");
  });
  it("waits on the exact first-paint shape that shipped the bug: loading=true so signedIn reads false", () => {
    expect(
      settleMineDefault({
        authLoading: true,
        profileChecked: false,
        signedIn: false,
        hasCv: false,
        hasScore: false,
        stored: null,
      }),
    ).toBe("wait");
  });
  it("waits for a signed-in visitor's profile fetch before trusting hasCv", () => {
    expect(settleMineDefault({ ...ready, profileChecked: false })).toBe("wait");
  });
  it("does not wait on profileChecked for a logged-out visitor (it never flips true for one)", () => {
    expect(
      settleMineDefault({ ...ready, signedIn: false, hasCv: false, hasScore: false, profileChecked: false }),
    ).toBe(false);
  });
  it("waits for the first landed score when nothing is stored", () => {
    expect(settleMineDefault({ ...ready, hasScore: false })).toBe("wait");
  });
  it("settles ON once auth, profile, and the first score have all landed", () => {
    expect(settleMineDefault(ready)).toBe(true);
  });
  it("an explicit stored choice settles immediately once auth/profile are ready, without waiting on hasScore", () => {
    expect(settleMineDefault({ ...ready, hasScore: false, stored: true })).toBe(true);
    expect(settleMineDefault({ ...ready, stored: false })).toBe(false);
  });
});

describe("shouldForceMineOff (issue #154 fix round 1, blocker 2: sign-out transition)", () => {
  it("forces mine off when signed out mid-session with mine still active", () => {
    expect(shouldForceMineOff({ signedIn: false, hasCv: false, mine: true })).toBe(true);
  });
  it("forces mine off when the CV drops while still signed in", () => {
    expect(shouldForceMineOff({ signedIn: true, hasCv: false, mine: true })).toBe(true);
  });
  it("does nothing once mine is already off", () => {
    expect(shouldForceMineOff({ signedIn: false, hasCv: false, mine: false })).toBe(false);
  });
  it("does nothing for a steady signed-in, scored session", () => {
    expect(shouldForceMineOff({ signedIn: true, hasCv: true, mine: true })).toBe(false);
  });
});

describe("readStoredMine / writeStoredMine (issue #154 per-browser persistence)", () => {
  beforeEach(() => localStorage.clear());

  it("returns null when nothing has been stored yet", () => {
    expect(readStoredMine()).toBeNull();
  });
  it("round-trips an explicit true/false choice", () => {
    writeStoredMine(true);
    expect(readStoredMine()).toBe(true);
    writeStoredMine(false);
    expect(readStoredMine()).toBe(false);
  });
});

describe("railHeading (issue #154 — 'Best fit' retired)", () => {
  it("reads 'Your matches' for a scored user on the default landing", () => {
    expect(railHeading(true, true)).toBe("Your matches");
  });
  it("reads 'Your matches' once anything has narrowed the view, scored or not", () => {
    expect(railHeading(true, false)).toBe("Your matches");
    expect(railHeading(false, false)).toBe("Your matches");
  });
  it("reads 'Hot right now' only for the anon/no-CV default landing", () => {
    expect(railHeading(false, true)).toBe("Hot right now");
  });
  it("never returns 'Best fit'", () => {
    for (const scored of [true, false]) {
      for (const defaultView of [true, false]) {
        expect(railHeading(scored, defaultView)).not.toBe("Best fit");
      }
    }
  });
});
