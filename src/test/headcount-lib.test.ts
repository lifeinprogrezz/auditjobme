// Pins the ONE company-size vocabulary (issue #68 item 6).
//
// `companies.headcount_bucket` carries about 95% of the deterministic ranker's
// power, so a stray value there is not untidiness, it is noise in the strongest
// signal the product has. These tests hold three things still:
//   1. normalizeHeadcountBucket can only ever emit a canonical rung or null,
//   2. the SQL CHECK constraint and the JavaScript constant list the same rungs,
//   3. every writer of the column goes through the normalizer.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HEADCOUNT_BUCKETS,
  bucketForCount,
  bucketForRange,
  companyKey,
  isHeadcountBucket,
  normalizeHeadcountBucket,
} from "../../scripts/headcount-lib.mjs";
import { buildSizeIndex, matchIsSafe } from "../../scripts/backfill-headcount.mjs";
import { sizeBand } from "@/lib/roles";

const REPO = process.cwd();
const MIGRATION = join(REPO, "supabase/migrations/20260726101000_headcount_vocabulary.sql");

describe("the vocabulary itself", () => {
  it("is contiguous and disjoint — every headcount lands in exactly one rung", () => {
    const seen = new Set<string>();
    let previous: string | null = null;
    for (const n of [1, 10, 11, 50, 51, 200, 201, 500, 501, 2000, 2001, 50_000]) {
      const bucket = bucketForCount(n);
      expect(bucket).not.toBeNull();
      expect(HEADCOUNT_BUCKETS).toContain(bucket);
      if (bucket !== previous) {
        expect(seen.has(bucket as string)).toBe(false); // never revisits a rung
        seen.add(bucket as string);
        previous = bucket;
      }
    }
    expect(seen.size).toBe(HEADCOUNT_BUCKETS.length); // all six are reachable
  });

  it("has no headcount below 1", () => {
    expect(bucketForCount(0)).toBeNull();
    expect(bucketForCount(-5)).toBeNull();
    expect(bucketForCount(Number.NaN)).toBeNull();
  });
});

describe("normalizeHeadcountBucket", () => {
  it("passes the canonical tokens through unchanged", () => {
    for (const b of HEADCOUNT_BUCKETS) expect(normalizeHeadcountBucket(b)).toBe(b);
  });

  it("collapses the career-ops-shaped scheme by midpoint", () => {
    expect(normalizeHeadcountBucket("<10")).toBe("1-10");
    expect(normalizeHeadcountBucket("10-30")).toBe("11-50");
    expect(normalizeHeadcountBucket("30-100")).toBe("51-200");
    expect(normalizeHeadcountBucket("100-500")).toBe("201-500");
    expect(normalizeHeadcountBucket("500+")).toBe("501-2000");
  });

  it("collapses the LinkedIn-shaped scheme", () => {
    expect(normalizeHeadcountBucket("1-10")).toBe("1-10");
    expect(normalizeHeadcountBucket("11-50")).toBe("11-50");
    expect(normalizeHeadcountBucket("51-200")).toBe("51-200");
    expect(normalizeHeadcountBucket("201-500")).toBe("201-500");
    expect(normalizeHeadcountBucket("500-2k")).toBe("501-2000");
    expect(normalizeHeadcountBucket("2k+")).toBe("2001+");
  });

  it("agrees with the collapse the app already applied at display time", () => {
    // sizeBand has mapped both legacy schemes since 2026-07-06. Migrating the
    // column must not move any company relative to what users already saw.
    for (const legacy of ["<10", "10-30", "30-100", "100-500", "500+", "500-2k", "2k+"]) {
      expect(sizeBand(normalizeHeadcountBucket(legacy))).toBe(sizeBand(legacy));
    }
  });

  it("reads the free text sources actually emit", () => {
    expect(normalizeHeadcountBucket("~40")).toBe("11-50");
    expect(normalizeHeadcountBucket("about 200 people")).toBe("51-200");
    expect(normalizeHeadcountBucket("10 - 30")).toBe("11-50");
    expect(normalizeHeadcountBucket("51 to 200")).toBe("51-200");
    expect(normalizeHeadcountBucket("501-1000")).toBe("501-2000");
    expect(normalizeHeadcountBucket("5,000+")).toBe("2001+");
    expect(normalizeHeadcountBucket("under 10")).toBe("1-10");
    expect(normalizeHeadcountBucket("120 employees")).toBe("51-200");
    expect(normalizeHeadcountBucket(340)).toBe("201-500");
  });

  it("returns null rather than guess", () => {
    for (const junk of [null, undefined, "", "   ", "banana", "0", "lots", "series B", {}, []]) {
      expect(normalizeHeadcountBucket(junk)).toBeNull();
    }
  });

  it("CANNOT emit a value outside the vocabulary, whatever it is fed", () => {
    const corpus = [
      ...HEADCOUNT_BUCKETS,
      "<10", "10-30", "30-100", "100-500", "500+", "500-2k", "2k+",
      "1-10 employees", "2-10", "40-50", "50-100", "150-200", "1k-5k", "10k+",
      "~40", "approx. 300", "circa 1,200 staff", "over 500", "more than 2k",
      "fewer than 50", "up to 10", "N/A", "unknown", "-1", "0-0", "999999999999",
      "51–200", "51—200", "  51-200  ", "51-200+", "TWO HUNDRED", "🙂", "3.5k",
      "", " ", "null", "undefined", "{}", "[object Object]",
    ];
    for (const input of corpus) {
      const out = normalizeHeadcountBucket(input);
      if (out !== null) expect(isHeadcountBucket(out)).toBe(true);
    }
  });
});

describe("bucketForRange", () => {
  it("uses the midpoint of a closed range", () => {
    expect(bucketForRange(35, 45)).toBe("11-50");
    expect(bucketForRange(400, 500)).toBe("201-500");
    expect(bucketForRange(1200, 1300)).toBe("501-2000");
  });
  it("reads an open-ended range as more than the minimum", () => {
    expect(bucketForRange(500, null)).toBe("501-2000");
    expect(bucketForRange(2000, null)).toBe("2001+");
  });
  it("returns null when there is nothing to read", () => {
    expect(bucketForRange(null, null)).toBeNull();
    expect(bucketForRange(500, 100)).toBeNull(); // inverted
  });
});

describe("companyKey", () => {
  it("matches the same company across sources", () => {
    expect(companyKey("Flohealth")).toBe(companyKey("Flo Health"));
    expect(companyKey("Smartly.io")).toBe(companyKey("Smartlyio"));
    expect(companyKey("Riskledger")).toBe(companyKey("Risk Ledger"));
    expect(companyKey("Forto GmbH")).toBe(companyKey("Forto"));
  });
  it("keeps distinct companies distinct", () => {
    expect(companyKey("Primer")).not.toBe(companyKey("Primer Labs"));
    expect(companyKey("Stream")).not.toBe(companyKey("Streamline"));
    expect(companyKey("")).toBe("");
  });
});

describe("the startupmap backfill only writes what it is sure of", () => {
  const directory = [
    { name: "Heron Data", team_size_min: 11, team_size_max: 50 },
    { name: "Too Good To Go", team_size_min: 1200, team_size_max: 1300 },
    { name: "Nova", team_size_min: 5, team_size_max: 10 }, // one of two Novas
    { name: "Nova", team_size_min: 900, team_size_max: 1000 },
    { name: "Sizeless", team_size_min: null, team_size_max: null },
    { name: "Light", team_size_min: 51, team_size_max: 200 },
  ];
  const index = buildSizeIndex(directory);

  it("indexes companies that state a size", () => {
    expect(index.get(companyKey("Herondata"))?.bucket).toBe("11-50");
    expect(index.get(companyKey("Toogoodtogo"))?.bucket).toBe("501-2000");
  });
  it("drops a name two companies share — we cannot tell whose size it is", () => {
    expect(index.has(companyKey("Nova"))).toBe(false);
  });
  it("drops a company with no stated size rather than invent one", () => {
    expect(index.has(companyKey("Sizeless"))).toBe(false);
  });
  it("refuses a short generic name unless the names match exactly", () => {
    // "Light Inc" (light.inc) is not necessarily the directory's "Light".
    expect(matchIsSafe("Light Inc", "Light", companyKey("Light Inc"))).toBe(false);
    expect(matchIsSafe("Light", "light", companyKey("Light"))).toBe(true);
    expect(matchIsSafe("Herondata", "Heron Data", companyKey("Herondata"))).toBe(true);
    expect(matchIsSafe("Anything", "Anything", "")).toBe(false);
  });
});

describe("rule and code move together", () => {
  it("the SQL CHECK constraint lists exactly the JavaScript vocabulary", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const check = sql.match(/headcount_bucket = any \(array\[([^\]]+)\]\)/);
    expect(check, "the migration must pin the vocabulary in a CHECK").not.toBeNull();
    const inSql = (check as RegExpMatchArray)[1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""));
    expect(inSql).toEqual([...HEADCOUNT_BUCKETS]);
  });

  it("every writer of headcount_bucket goes through the normalizer", () => {
    const dir = join(REPO, "scripts");
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => join(dir, f));
    // An assignment or object-property write, not a `headcount_bucket == null` read.
    const writers = files.filter((f) =>
      /headcount_bucket\s*[:=][^=]/.test(readFileSync(f, "utf8")),
    );
    expect(writers.length, "expected at least one writer to exist").toBeGreaterThan(0);
    for (const f of writers) {
      expect(
        readFileSync(f, "utf8").includes("normalizeHeadcountBucket"),
        `${relative(REPO, f)} writes headcount_bucket without the normalizer`,
      ).toBe(true);
    }
  });

  it("the display layer understands every canonical rung", () => {
    // A rung the map cannot band would silently vanish from the Size filter.
    for (const b of HEADCOUNT_BUCKETS) expect(sizeBand(b)).not.toBeNull();
  });
});
