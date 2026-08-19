// Pins the ONE industry vocabulary and its liquidity gate (issue #70).
//
// `companies.sector` is AND-ed into the /roles filter AND into the paid scoring
// prefilter, so a stray value there is not untidiness — it silently costs a user
// roles they asked for. And an industry offered in a picker that cannot return
// roles is worse than offering nothing: the user reads the empty page as "no jobs
// for me" rather than "we do not cover that".
//
// These tests hold five things still:
//   1. normalizeSector can only ever emit a canonical industry or null,
//   2. every string the live catalog actually carried resolves, deliberately,
//   3. the SQL CHECK constraint and the JavaScript constant list the same values,
//   4. every writer of the column goes through the normalizer,
//   5. the liquidity gate offers an industry only when it can return roles.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DROPPED_SECTORS,
  MIN_SECTOR_EMPLOYERS,
  MIN_SECTOR_ROLES,
  SECTORS,
  SECTOR_ALIASES,
  isPickableSector,
  isSector,
  normalizeSector,
} from "../../scripts/sector-lib.mjs";
import {
  normalizeTargetSectors,
  pickableSectors,
  sectorLiquidity,
  type SectorStat,
} from "@/lib/sectors";

const REPO = process.cwd();
const MIGRATION = join(REPO, "supabase/migrations/20260819120000_sector_vocabulary.sql");

/** Every distinct companies.sector string live on 2026-08-19, with its live-role
 *  count and its distinct-employer count. The measurement this whole issue is
 *  built on — kept verbatim so a future edit can be judged against real data
 *  rather than against an intuition about what the catalog looks like. */
const LIVE_SECTOR_STRINGS = [
  "Fintech", "AI & machine learning", "Aerospace & defense", "Energy", "Healthtech",
  "Edtech", "Medtech & devices", "Data & analytics", "Productivity & collaboration",
  "HR tech", "Travel & hospitality", "Food delivery", "E-commerce & retail",
  "Sales & marketing tech", "Observability and Security", "Supply chain & ops tech",
  "Cybersecurity", "Data & Analytics", "Climate tech", "Health Tech",
  "Legal & compliance tech", "Real estate tech", "Customer Service / AI",
  "Work Management / Productivity Software", "Developer tools", "No-code & automation",
  "Sports & wellness", "AI", "Mobility & transport", "Adtech", "Enterprise Software",
  "Wealthtech & insurtech", "Mobility", "Robotics", "EdTech", "SaaS", "E-commerce",
  "E-commerce & retail tech", "Digital Health", "Logistics", "Food Waste / Marketplace",
  "Audit Tech / AI", "Gaming", "Agritech & foodtech", "Data Management", "Hospitality",
  "Media & entertainment", "Construction tech", "Software/SaaS",
  "Hardware & semiconductors", "AI/CX", "Insurtech", "IoT & sensors", "Maritime",
];

describe("the vocabulary itself", () => {
  it("is 28 distinct industries", () => {
    expect(SECTORS.length).toBe(28);
    expect(new Set(SECTORS).size).toBe(SECTORS.length);
  });

  it("every alias points at a canonical industry", () => {
    for (const [variant, canonical] of Object.entries(SECTOR_ALIASES)) {
      expect(isSector(canonical), `${variant} → ${canonical} is not canonical`).toBe(true);
    }
  });

  it("no dropped string is also an alias or a canonical name", () => {
    for (const d of DROPPED_SECTORS) {
      expect(SECTORS).not.toContain(d);
      expect(Object.keys(SECTOR_ALIASES)).not.toContain(d);
    }
  });
});

describe("normalizeSector", () => {
  it("passes the canonical names through unchanged", () => {
    for (const s of SECTORS) expect(normalizeSector(s)).toBe(s);
  });

  it("folds the collisions that split one industry into several chips", () => {
    // Each group was a separate chip in the live catalog, and picking one hid the
    // roles filed under the others.
    expect(normalizeSector("Health Tech")).toBe("Healthtech");
    expect(normalizeSector("Digital Health")).toBe("Healthtech");
    expect(normalizeSector("Data & Analytics")).toBe("Data & analytics");
    expect(normalizeSector("Data Management")).toBe("Data & analytics");
    expect(normalizeSector("EdTech")).toBe("Edtech");
    expect(normalizeSector("AI")).toBe("AI & machine learning");
    expect(normalizeSector("E-commerce")).toBe("E-commerce & retail");
    expect(normalizeSector("E-commerce & retail tech")).toBe("E-commerce & retail");
    expect(normalizeSector("Mobility")).toBe("Mobility & transport");
    expect(normalizeSector("Hospitality")).toBe("Travel & hospitality");
    expect(normalizeSector("Insurtech")).toBe("Wealthtech & insurtech");
    expect(normalizeSector("Logistics")).toBe("Supply chain & logistics");
    expect(normalizeSector("Supply chain & ops tech")).toBe("Supply chain & logistics");
    expect(normalizeSector("Work Management / Productivity Software")).toBe(
      "Productivity & collaboration",
    );
  });

  it("folds the single-company enrichment artifacts into a real industry", () => {
    expect(normalizeSector("Audit Tech / AI")).toBe("Legal & compliance tech");
    expect(normalizeSector("Customer Service / AI")).toBe("Sales, marketing & CX tech");
    expect(normalizeSector("Food Waste / Marketplace")).toBe("Food & agritech");
    expect(normalizeSector("Observability and Security")).toBe(
      "Developer tools & infrastructure",
    );
    expect(normalizeSector("Maritime")).toBe("Mobility & transport");
  });

  it("drops the business-model words rather than offering them as industries", () => {
    // "SaaS" is true of most of the catalog and says nothing about the space a
    // job-seeker would work in, so it is not a chip anyone can act on.
    for (const d of DROPPED_SECTORS) expect(normalizeSector(d)).toBeNull();
  });

  it("ignores case and punctuation, which is where the variants came from", () => {
    expect(normalizeSector("fintech")).toBe("Fintech");
    expect(normalizeSector("  FINTECH  ")).toBe("Fintech");
    expect(normalizeSector("HR Tech")).toBe("HR tech");
    expect(normalizeSector("climate-tech")).toBe("Climate tech");
    expect(normalizeSector("AI and machine learning")).toBe("AI & machine learning");
  });

  it("returns null rather than guess", () => {
    for (const junk of [null, undefined, "", "   ", "banana", "B2B", "Web3", 42, {}, []]) {
      expect(normalizeSector(junk as unknown as string)).toBeNull();
    }
  });

  it("CANNOT emit a value outside the vocabulary, whatever it is fed", () => {
    const corpus = [
      ...SECTORS,
      ...Object.keys(SECTOR_ALIASES),
      ...DROPPED_SECTORS,
      ...LIVE_SECTOR_STRINGS,
      "fintech!!", "Fin tech", "HEALTH TECH", "e commerce", "Data&Analytics",
      "null", "undefined", "{}", "[object Object]", "🙂", "-", "   ",
    ];
    for (const input of corpus) {
      const out = normalizeSector(input);
      if (out !== null) expect(isSector(out)).toBe(true);
    }
  });

  it("resolves every string the live catalog actually held — deliberately", () => {
    // Each of the 54 is either folded onto an industry or explicitly dropped.
    // A NEW string appearing later must be judged and added, not left to chance:
    // this test is what makes that judgment visible.
    const dropped = new Set(DROPPED_SECTORS.map(String));
    for (const raw of LIVE_SECTOR_STRINGS) {
      const out = normalizeSector(raw);
      if (dropped.has(raw)) expect(out, `${raw} should be dropped`).toBeNull();
      else expect(isSector(out), `${raw} resolved to ${out}`).toBe(true);
    }
  });
});

describe("normalizeTargetSectors", () => {
  it("translates a stored target that predates the vocabulary", () => {
    expect(normalizeTargetSectors(["Health Tech", "Fintech"])).toEqual(["Healthtech", "Fintech"]);
  });
  it("collapses two variants of one industry into one target", () => {
    expect(normalizeTargetSectors(["Healthtech", "Digital Health"])).toEqual(["Healthtech"]);
  });
  it("drops what it cannot map, leaving 'no preference' rather than a dead target", () => {
    expect(normalizeTargetSectors(["SaaS", "Web3"])).toEqual([]);
    expect(normalizeTargetSectors(null)).toEqual([]);
  });
});

describe("sectorLiquidity", () => {
  const jobs = [
    { sector: "Fintech", company_id: "a" },
    { sector: "Fintech", company_id: "a" },
    { sector: "Fintech", company_id: "b" },
    { sector: "Robotics", company_id: "c" },
    { sector: null, company_id: "d" },
    { sector: "Edtech", company_id: null, company: "Named Co" },
  ];

  it("counts roles and DISTINCT employers per industry", () => {
    const stats = sectorLiquidity(jobs);
    const fintech = stats.find((s) => s.value === "Fintech");
    expect(fintech).toEqual({ value: "Fintech", label: "Fintech", count: 3, employers: 2 });
  });

  it("falls back to the company name when no company row is linked", () => {
    expect(sectorLiquidity(jobs).find((s) => s.value === "Edtech")?.employers).toBe(1);
  });

  it("skips rows with no sector — about 62% of the live catalog", () => {
    expect(sectorLiquidity(jobs).some((s) => s.value == null)).toBe(false);
    expect(sectorLiquidity(jobs).reduce((n, s) => n + s.count, 0)).toBe(5);
  });

  it("ranks richest first", () => {
    expect(sectorLiquidity(jobs)[0].value).toBe("Fintech");
  });
});

describe("the liquidity gate", () => {
  const stat = (value: string, count: number, employers: number): SectorStat => ({
    value,
    label: value,
    count,
    employers,
  });

  it("needs BOTH enough employers and enough roles", () => {
    expect(isPickableSector(stat("ok", MIN_SECTOR_ROLES, MIN_SECTOR_EMPLOYERS))).toBe(true);
    expect(isPickableSector(stat("thin-roles", MIN_SECTOR_ROLES - 1, 9))).toBe(false);
    expect(isPickableSector(stat("thin-cos", 900, MIN_SECTOR_EMPLOYERS - 1))).toBe(false);
  });

  it("withholds a big industry that rests on ONE employer", () => {
    // The live case this rule exists for: "Medtech & devices" carried 108 live
    // roles across a single company, and that company's sector was a data error.
    // A role-count rule alone would have promoted one bad row into a whole chip.
    expect(isPickableSector(stat("Medtech & devices", 108, 1))).toBe(false);
    // And "Sports & wellness" — 23 roles, one employer, two of them product roles.
    expect(isPickableSector(stat("Sports & wellness", 23, 1))).toBe(false);
  });

  it("admits a smaller industry that is spread across employers", () => {
    // Ranked by roles, one-employer "Sports & wellness" (23) outranks
    // five-employer "No-code & automation" (25). Ranked by employers they separate.
    expect(isPickableSector(stat("No-code & automation", 25, 5))).toBe(true);
  });

  it("the role floor catches an industry a departing employer has hollowed out", () => {
    // "Food & agritech" is 82% one employer. Without the floor it would keep its
    // chip on the 14 roles left behind.
    expect(isPickableSector(stat("Food & agritech", 14, 3))).toBe(false);
  });

  it("filters a live-shaped catalog down to what can answer", () => {
    const stats = [
      stat("Fintech", 745, 58),
      stat("Medtech & devices", 108, 1),
      stat("Wealthtech & insurtech", 22, 3),
      stat("Robotics", 13, 2),
      stat("Biotech", 0, 0),
    ];
    expect(pickableSectors(stats).map((s) => s.value)).toEqual([
      "Fintech",
      "Wealthtech & insurtech",
    ]);
  });

  it("keeps an already-chosen industry visible even once it stops passing", () => {
    // Dropping a stored choice out of the picker would leave the user staring at a
    // saved target they can neither see nor clear.
    const stats = [stat("Fintech", 745, 58), stat("Robotics", 13, 2)];
    expect(pickableSectors(stats, ["Robotics"]).map((s) => s.value)).toEqual([
      "Fintech",
      "Robotics",
    ]);
  });

  it("offers NOTHING when there is no live catalog to derive from", () => {
    // The bug this replaces: a hardcoded FALLBACK_SECTORS list of 12, of which 8
    // matched zero live rows. A list that can lie is worse than no list.
    expect(pickableSectors([])).toEqual([]);
  });
});

describe("rule and code move together", () => {
  it("the SQL CHECK constraint lists exactly the JavaScript vocabulary", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const check = sql.match(/sector = any \(array\[([^\]]+)\]\)/);
    expect(check, "the migration must pin the vocabulary in a CHECK").not.toBeNull();
    // Split on the quotes, not on commas: three industry names contain a comma
    // ("Media, entertainment & gaming"), and a comma split silently tore them in two.
    const inSql = [...(check as RegExpMatchArray)[1].matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
      m[1].replace(/''/g, "'"),
    );
    expect(inSql).toEqual([...SECTORS]);
  });

  it("the migration's alias map covers every alias and drop the library knows", () => {
    // The migration rewrites the stored rows; the library normalizes new writes.
    // If one knows a variant and the other does not, a row survives the migration
    // that the writer would have folded — the exact drift this issue closes.
    const sql = readFileSync(MIGRATION, "utf8");
    const tidy = (raw: string) =>
      raw
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const inSql = new Set(
      [...sql.matchAll(/^ {4}\('([^']*)', (?:'[^']*'|null)\),?$/gm)].map((m) => m[1]),
    );
    for (const key of [...SECTORS, ...Object.keys(SECTOR_ALIASES), ...DROPPED_SECTORS]) {
      expect(inSql.has(tidy(key)), `migration is missing "${key}"`).toBe(true);
    }
  });

  it("every writer of companies.sector goes through the normalizer", () => {
    const dir = join(REPO, "scripts");
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".mjs") && !f.endsWith("sector-lib.mjs"))
      .map((f) => join(dir, f));
    // An assignment or object-property write, not a `sector == null` read.
    const writers = files.filter((f) => /\bsector\s*[:=][^=]/.test(readFileSync(f, "utf8")));
    expect(writers.length, "expected at least one writer to exist").toBeGreaterThan(0);
    for (const f of writers) {
      expect(
        readFileSync(f, "utf8").includes("normalizeSector"),
        `${relative(REPO, f)} writes sector without the normalizer`,
      ).toBe(true);
    }
  });

  it("the enrichment prompt offers the model the closed vocabulary", () => {
    // A model asked for "a short industry label" invents one; asked to pick from a
    // list, it picks. The normalizer is the backstop, not the only defence.
    const src = readFileSync(join(REPO, "scripts/enrich-companies.mjs"), "utf8");
    expect(src).toMatch(/SECTORS\.join/);
  });
});
