// src/lib/pdfLines.ts — turn a PDF page's text items back into LINES. Pure, so the
// grouping is testable without loading the PDF engine.
//
// WHY (#150): the extractor used to join every item on a page with a single space,
// which flattened a CV into one paragraph before anything downstream could read it.
// Section headings, job titles, dates and bullets all became the same run of words.
// Portable Document Format files carry no line concept, only positioned runs, so the
// lines have to be rebuilt: the engine flags most line ends itself, and a change in
// the vertical position of a run catches the rest.

export type PdfTextItem = {
  str: string;
  /** The engine's own end-of-line flag, when it sets one. */
  hasEOL?: boolean;
  /** [a, b, c, d, x, y] — index 5 is the baseline's vertical position. */
  transform?: number[];
};

/** Baselines this close count as the same line (superscripts, mixed font sizes). */
const Y_TOLERANCE = 2.5;

/**
 * Group positioned text runs into lines, in reading order. Runs inside a line keep
 * the old space join, so a word the engine split across two runs reads exactly as it
 * did before; only the line breaks are new.
 */
export function linesFromItems(items: PdfTextItem[]): string[] {
  const lines: string[] = [];
  let current: string[] = [];
  let currentY: number | null = null;
  let breakBefore = false;

  const flush = () => {
    const line = current.join(" ").replace(/[ \t]+/g, " ").trim();
    if (line) lines.push(line);
    current = [];
    currentY = null;
  };

  for (const item of items) {
    const text = typeof item?.str === "string" ? item.str : "";
    const y = typeof item?.transform?.[5] === "number" ? item.transform[5] : null;
    const movedLine = currentY !== null && y !== null && Math.abs(y - currentY) > Y_TOLERANCE;
    if (current.length > 0 && (breakBefore || movedLine)) flush();
    if (text.trim()) {
      current.push(text);
      if (currentY === null) currentY = y;
    }
    breakBefore = item?.hasEOL === true;
  }
  flush();
  return lines;
}
