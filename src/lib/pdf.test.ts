import { describe, it, expect } from "vitest";
import { boldRuns, buildCvDoc, buildCoverDoc, pdfFilename } from "./pdf";
import { stripLeadingSummary } from "./cvHtml";

const CV = `Jane Doe
jane@example.com

Professional Experience

Acme Corp — Product Manager — 2021-2024
- Grew activation 40% by shipping onboarding redesign`;

// pdfmake content items are plain data objects; narrow just enough to read them back in tests.
type ContentItem = { text?: unknown; preserveLeadingSpaces?: boolean; [k: string]: unknown };

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
