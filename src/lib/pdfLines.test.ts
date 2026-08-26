import { describe, it, expect } from "vitest";
import { linesFromItems, type PdfTextItem } from "./pdfLines";

/** A run at a given baseline; the transform's index 5 is what the grouping reads. */
const run = (str: string, y: number, hasEOL = false): PdfTextItem => ({ str, hasEOL, transform: [1, 0, 0, 1, 0, y] });

describe("linesFromItems", () => {
  it("keeps a CV's lines apart instead of flattening the page into one paragraph", () => {
    const lines = linesFromItems([
      run("Acme Corp", 700),
      run("Product Manager", 686),
      run("09/2021 - Present", 672),
      run("Grew activation 40%", 658),
    ]);
    expect(lines).toEqual(["Acme Corp", "Product Manager", "09/2021 - Present", "Grew activation 40%"]);
  });

  it("joins the runs that share a baseline, the way the old extractor did within a line", () => {
    expect(linesFromItems([run("Grew", 700), run("activation", 700), run("40%", 700)])).toEqual([
      "Grew activation 40%",
    ]);
  });

  it("honours the engine's own end-of-line flag when two lines share a baseline", () => {
    expect(linesFromItems([run("Skills", 700, true), run("Languages", 700)])).toEqual(["Skills", "Languages"]);
  });

  it("treats a tiny baseline shift as the same line, so a superscript never breaks one", () => {
    expect(linesFromItems([run("Revenue up 40", 700), run("%", 702)])).toEqual(["Revenue up 40 %"]);
  });

  it("drops blank runs and survives items with no position at all", () => {
    expect(linesFromItems([{ str: "Jane Doe" }, { str: "   " }, { str: "jane@example.com" }])).toEqual([
      "Jane Doe jane@example.com",
    ]);
    expect(linesFromItems([])).toEqual([]);
  });
});
