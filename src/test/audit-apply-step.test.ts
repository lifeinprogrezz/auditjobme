// Pins issue #159 on the two surfaces it changed: the Apply page's audit step and
// the PDF the button produces.
//
// The step is read from source, the same file-reading idiom as audit-contacts.ts
// (the page needs a signed-in user, a job row and a live pipeline to render). The
// PDF is rendered for real from a fixture, because "the people to reach out to are
// a named section" is a claim about the document, not about the page.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generatePDFHTML } from "@/components/audit/pdfHtml.js";

const applySrc = readFileSync(join(process.cwd(), "src", "pages", "Apply.tsx"), "utf8");

const auditFixture = {
  cv: { name: "A Candidate" },
  company: { company: "Northwind", role: "Product Manager", role_url: "https://example.com/job", stats: [] },
  pains: {},
  diagnosis: { headline: "One line", sub: "A sub", findings: [] },
  proposals: { headline: "Three", proposals: [] },
  about: { headline: "Why me", stats: [], columns: [] },
  contacts: [
    { name: "Ida Berg", title: "VP Product", url: "https://www.linkedin.com/in/ida", why: "She owns this hire." },
    { name: "Tom Vega", title: "Talent Partner", url: "https://www.linkedin.com/in/tom", why: "He runs the process." },
  ],
  accent: "#8a9a8a",
  roleCtx: { audit_label: "Product Audit" },
};

describe("Apply audit step (issue #159)", () => {
  it("is one line and one button, in the words the owner asked for", () => {
    expect(applySrc).toContain("Get a company audit as a PDF, with two or three people to reach out to.");
    expect(applySrc).toContain("Prepare company audit");
  });

  it("keeps the longer explanation in the info popover, not on the page", () => {
    expect(applySrc).toContain("PopoverTrigger");
    expect(applySrc).toContain("What you get:");
    expect(applySrc).toContain("two audits free");
  });

  it("shows the generator's own free-limit wording when they are gone", () => {
    expect(applySrc).toContain("AUDIT_LIMIT_REACHED");
    expect(applySrc).toContain("atAuditLimit");
  });

  it("runs the shared pipeline and never grows a second copy of it", () => {
    expect(applySrc).toContain('from "@/lib/audit/runAudit"');
    expect(applySrc).toContain("runAudit({");
    expect(applySrc).not.toMatch(/web_search/i);
  });

  it("has no publish flow: what it saves stays private", () => {
    expect(applySrc).toContain("saveAuditPrivate");
    expect(applySrc).not.toMatch(/is_published/);
    expect(applySrc).not.toMatch(/publishAudit/);
  });

  it("writes no em-dash into the step's copy", () => {
    const step = applySrc.slice(applySrc.indexOf('eyebrow="Step 3"'), applySrc.indexOf('eyebrow="Step 4"'));
    const copy = step.match(/>[^<>{}]{12,}</g) ?? [];
    expect(copy.length).toBeGreaterThan(0);
    for (const line of copy) expect(line).not.toMatch(/—/);
  });
});

describe("the audit PDF (issue #159, LOCKED decision 4)", () => {
  it("names the people section and prints who they are", () => {
    const html = generatePDFHTML(auditFixture);
    expect(html).toContain("PEOPLE TO REACH OUT TO");
    expect(html).toContain("Ida Berg");
    expect(html).toContain("VP Product");
    expect(html).toContain("https://www.linkedin.com/in/tom");
  });

  it("caps the section at three people", () => {
    const many = [1, 2, 3, 4, 5].map((n) => ({ name: `Person ${n}`, title: "Lead", url: `https://example.com/${n}` }));
    const html = generatePDFHTML({ ...auditFixture, contacts: many });
    expect(html).toContain("Person 3");
    expect(html).not.toContain("Person 4");
  });

  it("leaves the section out entirely when the run found nobody", () => {
    const html = generatePDFHTML({ ...auditFixture, contacts: [] });
    expect(html).not.toContain("PEOPLE TO REACH OUT TO");
  });
});
