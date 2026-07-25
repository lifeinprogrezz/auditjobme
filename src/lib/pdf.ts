// src/lib/pdf.ts — one-click, TEXT-BASED PDF downloads for the apply bundle.
//
// Replaces the print-to-PDF dialog (Rober 7-16: click → the file lands in Downloads).
// pdfmake produces a real text-layer PDF — selectable, ATS-parseable — never a
// rasterized page image (html2canvas-style rasterizing would make the CV unreadable
// to ATS parsers, defeating the product). The library is imported dynamically so it
// stays out of the main bundle until the first download.
//
// THE TRUST RULE (same as cvHtml.ts): the CV BODY is the user's cv_text rendered
// VERBATIM — whitespace preserved, never reordered, reworded, or dropped. Only the
// tailored Professional Summary is prepended.
import { stripLeadingSummary } from "./cvHtml";
import type { CoverJson } from "./tailor";

/** pdfmake text run: **markers** become bold runs, everything else stays plain. */
export type TextRun = { text: string; bold?: boolean };

/** Split "grew **40%** fast" into runs — the pdfmake equivalent of cvHtml's boldify. */
export function boldRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const parts = (text || "").split(/\*\*([^*]+)\*\*/g);
  parts.forEach((part, i) => {
    if (!part) return;
    runs.push(i % 2 === 1 ? { text: part, bold: true } : { text: part });
  });
  return runs.length > 0 ? runs : [{ text: "" }];
}

// pdfmake document definitions are plain objects — kept pure and exported for tests.
type DocDef = Record<string, unknown>;

const H2 = { fontSize: 12.5, bold: true, color: "#4a5a4a", margin: [0, 14, 0, 5] as number[] };

export function buildCvDoc({ name, summary, cvText }: { name: string; summary: string; cvText: string }): DocDef {
  const body = stripLeadingSummary(cvText);
  return {
    pageSize: "A4",
    pageMargins: [48, 44, 48, 44],
    defaultStyle: { fontSize: 10.5, lineHeight: 1.3, color: "#1a1a1a" },
    content: [
      ...(name ? [{ text: name, fontSize: 20, bold: true, margin: [0, 0, 0, 8] }] : []),
      { text: "PROFESSIONAL SUMMARY", ...H2 },
      { text: boldRuns(summary), margin: [0, 0, 0, 4] },
      { text: "CURRICULUM VITAE", ...H2 },
      // preserveLeadingSpaces keeps the user's own indentation verbatim.
      { text: body, preserveLeadingSpaces: true },
    ],
  };
}

export function buildCoverDoc({ name, company, cover }: { name: string; company: string; cover: CoverJson }): DocDef {
  return {
    pageSize: "A4",
    pageMargins: [48, 44, 48, 44],
    defaultStyle: { fontSize: 11, lineHeight: 1.4, color: "#1a1a1a" },
    content: [
      ...(name ? [{ text: name, fontSize: 19, bold: true, margin: [0, 0, 0, 3] }] : []),
      { text: `Cover letter${company ? ` - ${company}` : ""}`, fontSize: 10, color: "#4a5a4a", margin: [0, 0, 0, 14] },
      ...[cover.greeting, cover.p1, cover.p2, cover.p3].map((p) => ({ text: p, margin: [0, 0, 0, 9] as number[] })),
      { text: cover.sign, margin: [0, 6, 0, 0] },
    ],
  };
}

/** Safe download filename: strips path/reserved characters, keeps it readable. */
export function pdfFilename(...parts: (string | null | undefined)[]): string {
  const base = parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => p.trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " "))
    .join(" - ");
  return `${base || "document"}.pdf`;
}

/** @types/pdfmake declares download(defaultFileName?) only; the runtime also takes a done callback. */
type DownloadableDoc = { download: (defaultFileName: string, cb: () => void) => void };

async function download(def: DocDef, filename: string): Promise<void> {
  const [{ default: pdfMake }, { default: vfsFonts }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  pdfMake.addVirtualFileSystem(vfsFonts);
  const doc = pdfMake.createPdf(def as never) as unknown as DownloadableDoc;
  await new Promise<void>((resolve) => doc.download(filename, () => resolve()));
}

export async function downloadCvPdf(input: { name: string; summary: string; cvText: string; company: string }): Promise<void> {
  await download(buildCvDoc(input), pdfFilename(input.name, "CV", input.company));
}

export async function downloadCoverPdf(input: { name: string; company: string; cover: CoverJson }): Promise<void> {
  await download(buildCoverDoc(input), pdfFilename(input.name, "Cover letter", input.company));
}
