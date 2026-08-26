import { describe, it, expect } from "vitest";
import {
  CV_FONT,
  boldRuns,
  buildCvDoc,
  buildCoverDoc,
  buildStructuredCvDoc,
  contactLines,
  coverDateLine,
  formatDateEN,
  jobMetaLine,
  linkHref,
  linkLabel,
  pdfFilename,
} from "./pdf";
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

  it("cover doc with no parsed contact renders a name, a dateline, salutation, the three body paragraphs, then the sign-off, in that order", () => {
    const doc = buildCoverDoc({
      name: "Jane Doe",
      company: "Acme",
      cover: { greeting: "Hi,", p1: "one", p2: "two", p3: "three", sign: "Warmly, Jane Doe" },
      date: new Date(2026, 7, 26),
    });
    const content = doc.content as ContentItem[];
    const texts = content.map((c) => c.text);
    // No contact on file: no location for a city, so the dateline is the bare date.
    expect(texts).toEqual(["Jane Doe", "26 August 2026", "Hi,", "one", "two", "three", "Warmly, Jane Doe"]);
  });

  it("cover doc with a parsed contact prints the letterhead's contact block and a city dateline (issue #151)", () => {
    const doc = buildCoverDoc({
      name: "ignored — the contact's own name wins",
      company: "Acme",
      cover: { greeting: "Hi,", p1: "one", p2: "two", p3: "three", sign: "Jane" },
      contact: { name: "Jane Doe", email: "jane@example.com", location: "Barcelona, Spain", links: [] },
      date: new Date(2026, 7, 26),
    });
    const content = doc.content as ContentItem[];
    expect(content[0].text).toBe("Jane Doe");
    expect(Array.isArray(content[1].stack)).toBe(true); // the contactLines block
    expect(content[2].text).toBe("Barcelona, 26 August 2026");
    expect(content[3].text).toBe("Hi,");
  });

  it("letterhead is IDENTICAL to the structured CV's — the cover letter shares it, not a second design", () => {
    const cvDoc = buildStructuredCvDoc({ name: "ignored", summary: "s", cv: STRUCTURED });
    const coverDoc = buildCoverDoc({
      name: "ignored",
      company: "Acme",
      cover: { greeting: "Hi,", p1: "a", p2: "b", p3: "c", sign: "Jane" },
      contact: STRUCTURED.contact,
      date: new Date(2026, 7, 26),
    });
    const nameItem = (doc: Record<string, unknown>) => (doc.content as ContentItem[])[0];
    expect(nameItem(coverDoc)).toEqual(nameItem(cvDoc));
    expect(coverDoc.defaultStyle).toEqual(cvDoc.defaultStyle);
  });

  it("formatDateEN and coverDateLine format the letter's dateline, city from the contact location", () => {
    const d = new Date(2026, 7, 26);
    expect(formatDateEN(d)).toBe("26 August 2026");
    expect(coverDateLine("Barcelona, Spain", d)).toBe("Barcelona, 26 August 2026");
    expect(coverDateLine(undefined, d)).toBe("26 August 2026");
    expect(coverDateLine("", d)).toBe("26 August 2026");
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
  it("renders the personal engine's layout: name, contact block, then the four sections in order", () => {
    const doc = buildStructuredCvDoc({ name: "ignored", summary: "Tailored for this role.", cv: STRUCTURED });
    const content = doc.content as ContentItem[];
    const texts = textsOf(doc);
    expect(texts[0]).toBe("Jane Doe");
    expect(Array.isArray(content[1].stack)).toBe(true);
    const headers = texts.filter((t): t is string => typeof t === "string" && /^[A-Z][A-Z &]+$/.test(t));
    expect(headers).toEqual([
      "PROFESSIONAL SUMMARY",
      "PROFESSIONAL EXPERIENCE",
      "EDUCATION",
      "SKILLS & ADDITIONAL INFORMATION",
    ]);
    expect(doc.pageSize).toBe("A4");
  });

  it("uses the personal engine's typography: Helvetica 11pt black on a 1.42 line height", () => {
    const doc = buildStructuredCvDoc({ name: "", summary: "Tailored.", cv: STRUCTURED });
    expect(doc.defaultStyle).toEqual({ font: CV_FONT, fontSize: 11, lineHeight: 1.42, color: "#000" });
    expect(CV_FONT).toBe("Helvetica");
    const content = doc.content as ContentItem[];
    // h1: full name, 20pt bold, 10px below (0.75pt per CSS px).
    expect(content[0]).toEqual({ text: "Jane Doe", fontSize: 20, bold: true, margin: [0, 0, 0, 7.5] });
    // h2: 13pt bold uppercase, 20px above and 9px below — NO colour tint, NO letter-spacing.
    const headers = content.filter((c) => typeof c.text === "string" && /^[A-Z][A-Z &]+$/.test(c.text));
    expect(headers.length).toBe(4);
    for (const h of headers) {
      expect(h.fontSize).toBe(13);
      expect(h.bold).toBe(true);
      expect(h.margin).toEqual([0, 15, 0, 6.75]);
      expect(h).not.toHaveProperty("color");
      expect(h).not.toHaveProperty("characterSpacing");
    }
  });

  it("prints the contact block one labelled item per line, links coloured, underlined and clickable", () => {
    const cv = validateCvStructured(
      {
        contact: {
          name: "Jane Doe",
          email: "jane@example.com",
          phone: "+34 600 000 000",
          location: "Berlin, Germany",
          links: ["https://www.linkedin.com/in/jane", "github.com/jane", "jane.dev"],
        },
        experience: [{ company: "Acme", role: "PM", start: "", end: "", bullets: ["Shipped it"] }],
      },
      "Jane Doe Acme PM Shipped it",
    ).cv;
    const doc = buildStructuredCvDoc({ name: "", summary: "", cv });
    const block = (doc.content as ContentItem[])[1] as { stack: ContentItem[] };
    const lines = block.stack.map((item) => item.text as ContentItem[]);
    // The engine's order: Location · Mobile · Email · Portfolio · GitHub · LinkedIn.
    expect(lines.map((runs) => runs[0].text)).toEqual([
      "Location: ",
      "Mobile: ",
      "Email: ",
      "Portfolio: ",
      "GitHub: ",
      "LinkedIn: ",
    ]);
    for (const runs of lines) expect(runs[0].bold).toBe(true);
    for (const item of block.stack) expect(item.fontSize).toBe(11);
    expect(lines[0][1]).toEqual({ text: "Berlin, Germany" });
    expect(lines[2][1]).toEqual({ text: "jane@example.com", link: "mailto:jane@example.com", color: "#1155cc", decoration: "underline" });
    expect(lines[3][1]).toEqual({ text: "jane.dev", link: "https://jane.dev", color: "#1155cc", decoration: "underline" });
    expect(lines[5][1]).toEqual({
      text: "https://www.linkedin.com/in/jane",
      link: "https://www.linkedin.com/in/jane",
      color: "#1155cc",
      decoration: "underline",
    });
  });

  it("prints each job as one unbreakable block: company, role, dates with location, then real bullets", () => {
    const doc = buildStructuredCvDoc({ name: "", summary: "s", cv: STRUCTURED });
    const block = (doc.content as ContentItem[]).find((c) => c.unbreakable === true) as {
      stack: ContentItem[];
      unbreakable?: boolean;
    };
    expect(block.unbreakable).toBe(true);
    expect(block.stack[0]).toEqual({ text: "Acme Corp", fontSize: 11, bold: true });
    expect(block.stack[1]).toEqual({ text: "Product Manager", fontSize: 11, bold: true });
    // The meta line is 11pt regular, black (no colour), with the engine's 5px below.
    expect(block.stack[2]).toEqual({ text: "09/2021 - Present | Barcelona, Spain", fontSize: 11, margin: [0, 0, 0, 3.75] });
    // A real list, not a paragraph of run-together text, 3px between items.
    const bullets = block.stack[3].ul as ContentItem[];
    expect(bullets.map((b) => b.text)).toEqual([
      "Grew activation 40% by shipping an onboarding redesign",
      "Led a team of 5 engineers",
    ]);
    for (const b of bullets) expect(b.margin).toEqual([0, 0, 0, 2.25]);
  });

  it("spaces blocks like the engine's h3 (13px above), collapsed against the section header for the first", () => {
    const twoJobs = validateCvStructured(
      {
        contact: { name: "Jane Doe", links: [] },
        experience: [
          { company: "Acme", role: "PM", start: "", end: "", bullets: ["Shipped it"] },
          { company: "Beta", role: "PM", start: "", end: "", bullets: ["Shipped that"] },
        ],
      },
      "Jane Doe Acme PM Shipped it Beta PM Shipped that",
    ).cv;
    const blocks = (buildStructuredCvDoc({ name: "", summary: "", cv: twoJobs }).content as ContentItem[]).filter((c) =>
      Array.isArray(c.stack),
    );
    expect(blocks.map((b) => b.margin)).toEqual([
      [0, 3, 0, 0],
      [0, 9.75, 0, 0],
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
    const block = (doc.content as ContentItem[]).find((c) => c.unbreakable === true) as { stack: ContentItem[] };
    expect((block.stack.at(-1)?.ul as ContentItem[]).map((b) => b.text)).toEqual(["did a **thing**"]);
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
    expect(texts).not.toContain("SKILLS & ADDITIONAL INFORMATION");
    expect(texts).not.toContain("PROFESSIONAL SUMMARY");
  });

  it("builds the meta and contact lines from whichever parts exist, with no orphan separators", () => {
    expect(jobMetaLine({ start: "2021", end: "2024", location: "Berlin" })).toBe("2021 - 2024 | Berlin");
    expect(jobMetaLine({ start: "2021", end: "" })).toBe("2021");
    expect(jobMetaLine({ location: "Berlin" })).toBe("Berlin");
    expect(jobMetaLine({})).toBe("");
    expect(contactLines({ name: "Jane", links: [] })).toEqual([]);
    expect(contactLines({ name: "Jane", email: "j@x.com", links: ["github.com/j"] })).toEqual([
      { label: "Email", text: "j@x.com", link: "mailto:j@x.com" },
      { label: "GitHub", text: "github.com/j", link: "https://github.com/j" },
    ]);
  });

  it("labels links by host — LinkedIn, GitHub, anything else Portfolio — and makes each clickable", () => {
    expect(linkLabel("https://www.linkedin.com/in/jane")).toBe("LinkedIn");
    expect(linkLabel("linkedin.com/in/jane")).toBe("LinkedIn");
    expect(linkLabel("github.com/jane")).toBe("GitHub");
    expect(linkLabel("https://jane.github.io")).toBe("Portfolio");
    expect(linkLabel("lifeinprogrezz.com")).toBe("Portfolio");
    expect(linkLabel("not a url at all")).toBe("Portfolio");
    expect(linkHref("github.com/jane")).toBe("https://github.com/jane");
    expect(linkHref("http://jane.dev/")).toBe("http://jane.dev/");
    expect(linkHref(" mailto:j@x.com ")).toBe("mailto:j@x.com");
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
