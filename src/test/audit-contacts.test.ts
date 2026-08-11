// Pins the COLD half of issue #41: the audit pass surfaces 2-3 public
// decision-makers (name, title, LinkedIn link) alongside its findings, and only
// there. The generation itself lives in AuditGenerator.jsx (a Haiku call with the
// web-search tool, validation-gated and retried like every other section) — what
// this test locks is the contract around it:
//   1. validateSections treats an empty contacts list as a MISSING section, so a
//      run that found nobody goes through the retry gate instead of silently
//      shipping an audit with no one to reach out to.
//   2. Audit-time ONLY: the Apply (prep) page must never grow a cold-contacts
//      fetch. Its people surface is the WARM panel — the user's own connections —
//      and the two stay separate (issue #41 "Independence"). Checked by reading
//      the source, the same file-reading idiom as account-export.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSections } from "@/components/audit/api.js";

const filled = {
  company: { stats: [{ v: 1 }] },
  diagnosis: { findings: [{ title: "f" }] },
  proposals: { proposals: [{ title: "p" }] },
  about: { columns: [{ skill: "s" }], stats: [] },
};

describe("audit cold contacts (issue #41)", () => {
  it("an audit without contacts fails the validation gate", () => {
    expect(validateSections({ ...filled, contacts: [] })).toContain("contacts");
    expect(validateSections({ ...filled, contacts: null })).toContain("contacts");
  });

  it("2-3 found decision-makers satisfy the gate", () => {
    const contacts = [
      { name: "A", title: "VP Product", url: "https://www.linkedin.com/in/a" },
      { name: "B", title: "Recruiter", url: "https://www.linkedin.com/in/b" },
    ];
    expect(validateSections({ ...filled, contacts })).toEqual([]);
  });

  it("the Apply page carries the warm panel, never a cold-contacts search", () => {
    const src = readFileSync(join(process.cwd(), "src", "pages", "Apply.tsx"), "utf8");
    // Warm half present: reads the user's OWN connections table.
    expect(src).toContain('from("connections")');
    // Cold half absent: no web search and no audit-contacts generation here.
    expect(src).not.toMatch(/web_search/i);
    expect(src).not.toMatch(/decision.?maker/i);
  });
});
