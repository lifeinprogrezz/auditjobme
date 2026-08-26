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
/** Horizontal position of an item (transform index 4), or 0 when unknown. */
const xOf = (item: PdfTextItem): number =>
  typeof item?.transform?.[4] === "number" ? item.transform[4] : 0;
const yOf = (item: PdfTextItem): number | null =>
  typeof item?.transform?.[5] === "number" ? item.transform[5] : null;

/**
 * Put items in READING order: top to bottom, then left to right. pdf.js hands
 * items back in content-stream order, which is the order the producer wrote
 * them, not the order a reader sees them. Chromium (the owner's own CV engine)
 * writes every block heading first and every bullet list afterwards, so a
 * stream-ordered CV read as "three companies, then all their bullets" and the
 * parser hung every bullet on the last company (2026-08-26). Items without a
 * position keep their relative stream order at the end. Stable sort.
 */
export function readingOrder(items: PdfTextItem[]): PdfTextItem[] {
  const indexed = items.map((item, i) => ({ item, i, y: yOf(item), x: xOf(item) }));
  indexed.sort((a, b) => {
    if (a.y === null && b.y === null) return a.i - b.i;
    if (a.y === null) return 1;
    if (b.y === null) return -1;
    const dy = b.y - a.y; // PDF y grows upward: larger y = higher on the page
    if (Math.abs(dy) > Y_TOLERANCE) return dy;
    if (a.x !== b.x) return a.x - b.x;
    return a.i - b.i;
  });
  return indexed.map((e) => e.item);
}

export function linesFromItems(rawItems: PdfTextItem[]): string[] {
  const items = readingOrder(rawItems);
  const lines: string[] = [];
  let current: string[] = [];
  let currentY: number | null = null;
  // The engine's own end-of-line flag still splits two runs that share a baseline
  // (two columns of a skills table); sorting keeps such runs adjacent because
  // they share y and the sort is stable on x, so the flag stays meaningful.
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
