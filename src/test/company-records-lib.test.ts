// Pins the pure company-record helpers (scripts/company-records-lib.mjs), issue
// #153 item B1: a `companies` row for every distinct company on live jobs that
// lacks one. Same pattern as src/test/logo-lib.test.ts -- a vitest wrapper around
// a scripts/*.mjs pure module, which is how these get covered by `npm test`
// (vitest.config.ts only globs src/**; scripts/*.test.mjs run via `node --test`
// are not part of the CI gate).
import { describe, expect, it } from "vitest";
import { slugForCompany, groupByCompanyName, uniqueSlug } from "../../scripts/company-records-lib.mjs";

describe("slugForCompany", () => {
  it("lowercases and underscore-separates, matching the live convention", () => {
    expect(slugForCompany("Delivery Hero")).toBe("delivery_hero");
    expect(slugForCompany("Mistral AI")).toBe("mistral_ai");
    expect(slugForCompany("Weflow | getweflow.com")).toBe("weflow_getweflow_com");
    expect(slugForCompany("NUMA Group (formerly COSI Group)")).toBe("numa_group_formerly_cosi_group");
    expect(slugForCompany("1Password")).toBe("1password");
  });

  it("folds diacritics before slugifying", () => {
    expect(slugForCompany("Café Ai")).toBe("cafe_ai");
    expect(slugForCompany("Müller")).toBe("muller");
  });

  it("collapses repeated separators and trims leading/trailing underscores", () => {
    expect(slugForCompany("  Acme -- Corp  ")).toBe("acme_corp");
    expect(slugForCompany("!!!")).toBe("");
  });

  it("never throws on empty or missing input", () => {
    expect(slugForCompany("")).toBe("");
    expect(slugForCompany(null as unknown as string)).toBe("");
    expect(slugForCompany(undefined as unknown as string)).toBe("");
  });
});

describe("groupByCompanyName", () => {
  it("groups by the EXACT lower(name) key -- the same key link_jobs_to_companies() matches on", () => {
    const rows = [{ company: "OpenAI" }, { company: "OpenAI" }, { company: "openai" }, { company: "Anthropic" }];
    const groups = groupByCompanyName(rows);
    expect(groups.size).toBe(2);
    expect(groups.get("openai")).toEqual({ name: "OpenAI", count: 3 });
    expect(groups.get("anthropic")).toEqual({ name: "Anthropic", count: 1 });
  });

  it("picks the most common exact spelling as the canonical name", () => {
    const rows = [
      { company: "acme inc" },
      { company: "Acme Inc" },
      { company: "Acme Inc" },
      { company: "ACME INC" },
    ];
    const groups = groupByCompanyName(rows);
    expect(groups.size).toBe(1);
    expect(groups.get("acme inc")?.name).toBe("Acme Inc");
    expect(groups.get("acme inc")?.count).toBe(4);
  });

  it("skips blank or whitespace-only company names", () => {
    const groups = groupByCompanyName([{ company: "" }, { company: "   " }, { company: null }, { company: "Real Co" }]);
    expect(groups.size).toBe(1);
    expect(groups.has("real co")).toBe(true);
  });
});

describe("uniqueSlug", () => {
  it("returns the base slug when it is free", () => {
    expect(uniqueSlug("acme", new Set())).toBe("acme");
  });

  it("appends a deterministic numeric suffix on collision", () => {
    expect(uniqueSlug("acme", new Set(["acme"]))).toBe("acme_2");
    expect(uniqueSlug("acme", new Set(["acme", "acme_2"]))).toBe("acme_3");
  });

  it("leaves an empty base empty (the caller skips it, never inserts)", () => {
    expect(uniqueSlug("", new Set())).toBe("");
  });
});
