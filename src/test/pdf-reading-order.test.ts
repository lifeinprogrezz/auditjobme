import { describe, it, expect } from "vitest";
import { linesFromItems, readingOrder, type PdfTextItem } from "@/lib/pdfLines";

// pdf.js returns items in content-stream order. Chromium (the owner's CV engine)
// writes every block heading first and every bullet afterwards, so a CV read as
// "three companies, then all their bullets" and the parser hung every bullet on
// the last company (2026-08-26, real upload). Reading order must win.
const item = (str: string, x: number, y: number): PdfTextItem => ({ str, transform: [1, 0, 0, 1, x, y] });

describe("readingOrder (top to bottom, then left to right)", () => {
  it("re-sorts a Chromium-style stream (headers first, bullets after) into reading order", () => {
    const stream = [
      item("GLIQUID", 43, 268),
      item("Founder & Head of Product", 43, 253),
      item("Tierra Labs Ltd", 43, 115),
      item("Founder & Head of Product", 43, 100),
      item("●", 56, 238),
      item("Built and launched a consumer exchange", 67, 238),
      item("●", 56, 85),
      item("Designed a Social + AI product", 67, 85),
    ];
    expect(linesFromItems(stream)).toEqual([
      "GLIQUID",
      "Founder & Head of Product",
      "● Built and launched a consumer exchange",
      "Tierra Labs Ltd",
      "Founder & Head of Product",
      "● Designed a Social + AI product",
    ]);
  });

  it("keeps same-line items left to right and tolerates baseline jitter", () => {
    const stream = [item("world", 80, 100.5), item("hello", 40, 101.9)];
    expect(linesFromItems(stream)).toEqual(["hello world"]);
  });

  it("puts items without a position last, in their original order, and is stable", () => {
    const a = { str: "a" } as PdfTextItem;
    const b = { str: "b" } as PdfTextItem;
    const out = readingOrder([a, item("top", 0, 500), b]);
    expect(out.map((i) => i.str)).toEqual(["top", "a", "b"]);
  });
});
