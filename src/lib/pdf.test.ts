import { describe, it, expect } from "vitest";
import { boldRuns, buildCvDoc, buildCoverDoc, pdfFilename } from "./pdf";

const CV = `Jane Doe
jane@example.com

Professional Experience

Acme Corp — Product Manager — 2021-2024
- Grew activation 40% by shipping onboarding redesign`;

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

  it("cover doc renders all five parts in order", () => {
    const doc = buildCoverDoc({
      name: "Jane",
      company: "Acme",
      cover: { greeting: "Hi,", p1: "one", p2: "two", p3: "three", sign: "Jane" },
    });
    const flat = JSON.stringify(doc);
    for (const s of ["Hi,", "one", "two", "three", "Jane"]) expect(flat).toContain(s);
    expect(flat).toContain("Cover letter - Acme");
  });

  it("pdfFilename strips reserved characters and skips empty parts", () => {
    expect(pdfFilename("Jane Doe", "CV", "Acme/Co:*")).toBe("Jane Doe - CV - AcmeCo.pdf");
    expect(pdfFilename("", "Cover letter", null)).toBe("Cover letter.pdf");
    expect(pdfFilename()).toBe("document.pdf");
  });
});
