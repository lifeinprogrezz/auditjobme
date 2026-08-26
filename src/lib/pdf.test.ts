import { describe, it, expect } from "vitest";
import { boldRuns, buildCvDoc, buildCoverDoc, buildStructuredCvDoc, contactLine, jobMetaLine, pdfFilename } from "./pdf";
import { stripLeadingSummary } from "./cvHtml";
import { validateCvStructured, type CvStructured } from "./cvStructured";

const CV = `Jane Doe
jane@example.com

Professional Experience

Acme Corp — Product Manager — 2021-2024
- Grew activation 40% by shipping onboarding redesign`;

// pdfmake content items are plain data objects; narrow just enough to read them back in tests.
type ContentItem = { text?: unknown; preserveLeadingSpaces?: boolean; [k: string]: unknown };

// The structured CV (#150): a parsed profile, validated against the CV it came from.
const STRUCTURED_SOURCE = `Jane Doe
jane@example.com | Barcelona, Spain

Acme Corp
Product Manager
09/2021 - Present | Barcelona, Spain
- Grew activation 40% by shipping an onboarding redesign
- Led a team of 5 engineers

University of Vigo
Bachelor in Business Administration
09/2015 - 06/2020`;

const STRUCTURED: CvStructured = validateCvStructured(
  {
    contact: { name: "Jane Doe", email: "jane@example.com", location: "Barcelona, Spain", links: [] },
    summary: "The summary my CV came with.",
    experience: [
      {
        company: "Acme Corp",
        role: "Product Manager",
        start: "09/2021",
        end: "Present",
        location: "Barcelona, Spain",
        bullets: ["Grew activation 40% by shipping an onboarding redesign", "Led a team of 5 engineers"],
      },
    ],
    education: [
      { school: "University of Vigo", degree: "Bachelor in Business Administration", start: "09/2015", end: "06/2020" },
    ],
    skills: [{ group: "Languages", items: ["Spanish", "English"] }],
    extras: ["Volunteer mentor at Code Club"],
  },
  STRUCTURED_SOURCE,
).cv;

/** Every string the document prints, flattened, for order and content assertions. */
function textsOf(doc: Record<string, unknown>): unknown[] {
  return (doc.content as ContentItem[]).map((c) => c.text);
}

describe("pdf doc builders", () => {
  it("boldRuns promotes **markers** to bold runs and keeps the rest plain", () => {
    expect(boldRuns("grew **40%** fast")).toEqual([
      { text: "grew " },
      { text: "40%", bold: true },
      { text: " fast" },
    ]);
    expect(boldRuns("no markers")).toEqual([{ text: "no markers" }]);
    expect(boldRuns("")).toEqual([{ text: "" }]);
  });

  it("CV doc carries the body VERBATIM (trust rule) and the tailored summary", () => {
    const doc = buildCvDoc({ name: "Jane Doe", summary: "I ship **fast**.", cvText: CV });
    const flat = JSON.stringify(doc);
    // body text appears verbatim, including the em-dash line the user wrote
    expect(flat).toContain("Acme Corp — Product Manager — 2021-2024");
    expect(flat).toContain("Grew activation 40%");
    expect(flat).toContain("Jane Doe");
    // summary rendered as bold runs
    expect(flat).toContain('"bold":true');
  });

  it("PINS the CV body to be byte-identical to stripLeadingSummary(cvText) — trust rule, exact match not substring", () => {
    const doc = buildCvDoc({ name: "Jane Doe", summary: "I ship fast.", cvText: CV });
    const content = doc.content as ContentItem[];
    const bodyItem = content.find((c) => c.preserveLeadingSpaces === true);
    expect(bodyItem).toBeDefined();
    // Exact equality, not .toContain — a future layout tweak that reorders, trims, or
    // rewords even one character of the body must fail this test.
    expect(bodyItem?.text).toBe(stripLeadingSummary(CV));
  });

  it("a CV body containing markdown-style ** markers is NOT bolded — verbatim means untouched, unlike the summary", () => {
    const cvWithMarkers = "Jane Doe\n\n**Section**\n- did a **thing**";
    const doc = buildCvDoc({ name: "Jane Doe", summary: "plain summary", cvText: cvWithMarkers });
    const content = doc.content as ContentItem[];
    const bodyItem = content.find((c) => c.preserveLeadingSpaces === true);
    // The raw asterisks pass through untouched — boldRuns is applied to the summary only.
    expect(bodyItem?.text).toBe(cvWithMarkers);
  });

  it("cover doc renders salutation, the three body paragraphs, then the sign-off, in that structural order", () => {
    const doc = buildCoverDoc({
      name: "Jane Doe",
      company: "Acme",
      cover: { greeting: "Hi,", p1: "one", p2: "two", p3: "three", sign: "Warmly, Jane Doe" },
    });
    const content = doc.content as ContentItem[];
    const texts = content.map((c) => c.text);
    expect(texts).toEqual(["Jane Doe", "Cover letter - Acme", "Hi,", "one", "two", "three", "Warmly, Jane Doe"]);
  });

  it("name heading style is IDENTICAL across the CV and the cover letter — one matched document pair", () => {
    const cvDoc = buildCvDoc({ name: "Jane Doe", summary: "s", cvText: "body" });
    const coverDoc = buildCoverDoc({
      name: "Jane Doe",
      company: "Acme",
      cover: { greeting: "Hi,", p1: "a", p2: "b", p3: "c", sign: "Jane" },
    });
    const nameItem = (doc: Record<string, unknown>) => (doc.content as ContentItem[])[0];
    const cvName = nameItem(cvDoc);
    const coverName = nameItem(coverDoc);
    expect(cvName.text).toBe("Jane Doe");
    expect(coverName.text).toBe("Jane Doe");
    expect(cvName.fontSize).toBe(coverName.fontSize);
    expect(cvName.bold).toBe(coverName.bold);
    expect(cvName.margin).toEqual(coverName.margin);
  });

  it("both docs stay real, ATS-parseable text — no rasterized image or canvas content anywhere in the definition", () => {
    const cvDoc = buildCvDoc({ name: "Jane Doe", summary: "I ship **fast**.", cvText: CV });
    const coverDoc = buildCoverDoc({
      name: "Jane Doe",
      company: "Acme",
      cover: { greeting: "Hi,", p1: "one", p2: "two", p3: "three", sign: "Jane" },
    });
    for (const doc of [cvDoc, coverDoc]) {
      const flat = JSON.stringify(doc);
      expect(flat).not.toContain('"image"');
      expect(flat).not.toContain('"canvas"');
      expect(flat).not.toContain('"svg"');
    }
  });

  it("pdfFilename strips reserved characters and skips empty parts", () => {
    expect(pdfFilename("Jane Doe", "CV", "Acme/Co:*")).toBe("Jane Doe - CV - AcmeCo.pdf");
    expect(pdfFilename("", "Cover letter", null)).toBe("Cover letter.pdf");
    expect(pdfFilename()).toBe("document.pdf");
  });
});

describe("structured CV doc (#150)", () => {
  it("renders the personal engine's layout: letterhead, contact line, then the four sections in order", () => {
    const doc = buildStructuredCvDoc({ name: "ignored", summary: "Tailored for this role.", cv: STRUCTURED });
    const texts = textsOf(doc);
    expect(texts[0]).toBe("Jane Doe");
    expect(texts[1]).toBe("Barcelona, Spain  \u00b7  jane@example.com");
    const headers = texts.filter((t): t is string => typeof t === "string" && /^[A-Z][A-Z ]+$/.test(t));
    expect(headers).toEqual([
      "PROFESSIONAL SUMMARY",
      "PROFESSIONAL EXPERIENCE",
      "EDUCATION",
      "SKILLS AND ADDITIONAL INFORMATION",
    ]);
    expect(doc.pageSize).toBe("A4");
  });

  it("prints each job as one unbreakable block: company, role, dates with location, then real bullets", () => {
    const doc = buildStructuredCvDoc({ name: "", summary: "s", cv: STRUCTURED });
    const block = (doc.content as ContentItem[]).find((c) => Array.isArray(c.stack)) as {
      stack: ContentItem[];
      unbreakable?: boolean;
    };
    expect(block.unbreakable).toBe(true);
    expect(block.stack[0].text).toBe("Acme Corp");
    expect(block.stack[1].text).toBe("Product Manager");
    expect(block.stack[2].text).toBe("09/2021 - Present | Barcelona, Spain");
    // A real list, not a paragraph of run-together text.
    expect(block.stack[3].ul).toEqual([
      "Grew activation 40% by shipping an onboarding redesign",
      "Led a team of 5 engineers",
    ]);
  });

  it("the tailored summary REPLACES the one the CV came with, so no summary prints twice", () => {
    const doc = buildStructuredCvDoc({ name: "", summary: "Tailored for this role.", cv: STRUCTURED });
    const flat = JSON.stringify(doc);
    expect(flat).toContain("Tailored for this role.");
    expect(flat).not.toContain("The summary my CV came with.");
  });

  it("normalises dashes and quotes for tracking systems on every printed string", () => {
    const typographic = validateCvStructured(
      {
        contact: { name: "Jane\u2019s CV", links: [] },
        experience: [
          {
            company: "Acme\u2014Corp",
            role: "Product Manager",
            start: "2021",
            end: "",
            bullets: ["Shipped the \u201Cnew\u201D onboarding\u2026"],
          },
        ],
      },
      "Jane\u2019s CV Acme\u2014Corp Product Manager 2021 Shipped the \u201Cnew\u201D onboarding\u2026",
    ).cv;
    const flat = JSON.stringify(buildStructuredCvDoc({ name: "", summary: "", cv: typographic }));
    expect(flat).toContain("Acme-Corp");
    expect(flat).toContain('Jane\'s CV');
    expect(flat).toContain('Shipped the \\"new\\" onboarding...');
    expect(flat).not.toContain("\u2014");
    expect(flat).not.toContain("\u2026");
  });

  it("is DETERMINISTIC: the same profile builds a byte-identical document definition", () => {
    const once = buildStructuredCvDoc({ name: "", summary: "Tailored.", cv: STRUCTURED });
    const twice = buildStructuredCvDoc({ name: "", summary: "Tailored.", cv: STRUCTURED });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    // The snapshot is the contract: a layout change must be a deliberate edit here.
    expect(JSON.stringify(once)).toMatchSnapshot();
  });

  it("bullets stay VERBATIM: markdown-style markers in the user's own words are never promoted to bold", () => {
    const withMarkers = validateCvStructured(
      {
        contact: { name: "Jane Doe", links: [] },
        experience: [{ company: "Acme", role: "PM", start: "", end: "", bullets: ["did a **thing**"] }],
      },
      "Jane Doe Acme PM did a **thing**",
    ).cv;
    const doc = buildStructuredCvDoc({ name: "", summary: "", cv: withMarkers });
    const block = (doc.content as ContentItem[]).find((c) => Array.isArray(c.stack)) as { stack: ContentItem[] };
    expect(block.stack.at(-1)?.ul).toEqual(["did a **thing**"]);
  });

  it("skips a section the CV has nothing for, instead of printing an empty heading", () => {
    const workOnly = validateCvStructured(
      {
        contact: { name: "Jane Doe", links: [] },
        experience: [{ company: "Acme", role: "PM", start: "", end: "", bullets: ["Shipped it"] }],
      },
      "Jane Doe Acme PM Shipped it",
    ).cv;
    const texts = textsOf(buildStructuredCvDoc({ name: "", summary: "", cv: workOnly }));
    expect(texts).not.toContain("EDUCATION");
    expect(texts).not.toContain("SKILLS AND ADDITIONAL INFORMATION");
    expect(texts).not.toContain("PROFESSIONAL SUMMARY");
  });

  it("builds the meta and contact lines from whichever parts exist, with no orphan separators", () => {
    expect(jobMetaLine({ start: "2021", end: "2024", location: "Berlin" })).toBe("2021 - 2024 | Berlin");
    expect(jobMetaLine({ start: "2021", end: "" })).toBe("2021");
    expect(jobMetaLine({ location: "Berlin" })).toBe("Berlin");
    expect(jobMetaLine({})).toBe("");
    expect(contactLine({ name: "Jane", links: [] })).toBe("");
    expect(contactLine({ name: "Jane", email: "j@x.com", links: ["github.com/j"] })).toBe(
      "j@x.com  \u00b7  github.com/j",
    );
  });
});

describe("buildCvDoc — which body path", () => {
  it("renders from the structure when there is one", () => {
    const doc = buildCvDoc({ name: "Jane Doe", summary: "Tailored.", cvText: CV, structured: STRUCTURED });
    expect(textsOf(doc)).toContain("PROFESSIONAL EXPERIENCE");
    expect(JSON.stringify(doc)).not.toContain("CURRICULUM VITAE");
  });

  it("falls back to the verbatim text render, UNCHANGED, when the profile is not parsed yet", () => {
    const legacy = buildCvDoc({ name: "Jane Doe", summary: "Tailored.", cvText: CV });
    expect(JSON.stringify(buildCvDoc({ name: "Jane Doe", summary: "Tailored.", cvText: CV, structured: null }))).toBe(
      JSON.stringify(legacy),
    );
    expect(textsOf(legacy)).toContain("CURRICULUM VITAE");
  });

  it("falls back too when the structure is too thin to render a CV from", () => {
    const thin = validateCvStructured({ contact: { name: "Jane Doe", links: [] } }, CV).cv;
    const doc = buildCvDoc({ name: "Jane Doe", summary: "Tailored.", cvText: CV, structured: thin });
    expect(textsOf(doc)).toContain("CURRICULUM VITAE");
  });
});
