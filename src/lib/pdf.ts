// src/lib/pdf.ts — one-click, TEXT-BASED PDF downloads for the apply bundle.
//
// Replaces the print-to-PDF dialog (Rober 7-16: click → the file lands in Downloads).
// pdfmake produces a real text-layer PDF — selectable, ATS-parseable — never a
// rasterized page image (html2canvas-style rasterizing would make the CV unreadable
// to ATS parsers, defeating the product). The library is imported dynamically so it
// stays out of the main bundle until the first download.
//
// THE TRUST RULE: the CV BODY is the user's own words. Nothing here is written by a
// language model except the tailored Professional Summary that goes on top.
//
// Two body paths, same rule (#150):
//  - STRUCTURED (preferred): the parsed profile from cvStructured.ts, rendered with
//    the personal engine's layout — letterhead, section headers, one block per job
//    with real bullets and dates. Every bullet and date in it was checked against
//    cv_text before it was stored, and the render is a pure function of the stored
//    structure, so the same profile prints the same document every time.
//  - TEXT (fallback, unchanged): cv_text printed verbatim, whitespace preserved, for
//    a profile that has not been parsed yet.
import { stripLeadingSummary } from "./cvHtml";
import { isCvStructuredUsable, normalizeForAts, type CvStructured } from "./cvStructured";
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

// Shared letterhead + section-header treatment so the CV and the cover letter read as one
// matched pair (same applicant, same document family) instead of two independently-tuned
// pages. Presentation only — no color blocks, no rules, one typeface family throughout.
const PAGE_MARGINS = [54, 50, 54, 50] as number[];
const NAME_STYLE = { fontSize: 20, bold: true, margin: [0, 0, 0, 6] as number[] };
// Section headers get a touch of tracked-caps spacing — a recruiter-CV convention that
// separates hierarchy levels without a decorative rule or a second color.
const SECTION_HEADER = {
  fontSize: 12.5,
  bold: true,
  color: "#4a5a4a",
  characterSpacing: 0.6,
  margin: [0, 18, 0, 6] as number[],
};
const META_STYLE = { fontSize: 10, color: "#4a5a4a", margin: [0, 0, 0, 16] as number[] };

const CONTACT_STYLE = { fontSize: 9.5, color: "#4a5a4a", margin: [0, 0, 0, 2] as number[] };
const COMPANY_STYLE = { fontSize: 11, bold: true };
const ROLE_STYLE = { fontSize: 10.5, bold: true };
const JOB_META_STYLE = { fontSize: 9.5, color: "#4a5a4a", margin: [0, 1, 0, 4] as number[] };
/** One job or one degree, kept off a page seam so a heading never strands its bullets. */
const BLOCK_MARGIN = [0, 0, 0, 10] as number[];

/** Every printed string goes through applicant-tracking-system normalisation. */
const ats = (text: string): string => normalizeForAts(text || "").trim();

/** "09/2021 - Present | Barcelona, Spain" from whichever parts the CV actually had. */
export function jobMetaLine(job: { start?: string; end?: string; location?: string }): string {
  const dates = [ats(job.start ?? ""), ats(job.end ?? "")].filter(Boolean).join(" - ");
  return [dates, ats(job.location ?? "")].filter(Boolean).join(" | ");
}

/** "Barcelona, Spain · +34 600 000 000 · jane@example.com · linkedin.com/in/jane" */
export function contactLine(contact: CvStructured["contact"]): string {
  return [ats(contact.location ?? ""), ats(contact.phone ?? ""), ats(contact.email ?? ""), ...contact.links.map(ats)]
    .filter(Boolean)
    .join("  \u00b7  ");
}

/**
 * The deterministic CV: the personal engine's layout, built from the parsed profile.
 * Pure — same structure in, byte-identical document definition out (pinned in
 * pdf.test.ts). The tailored summary REPLACES the summary the CV came with, so the
 * old one can never print twice.
 */
export function buildStructuredCvDoc({ name, summary, cv }: { name: string; summary: string; cv: CvStructured }): DocDef {
  const headline = ats(cv.contact.name || name);
  const contact = contactLine(cv.contact);
  const summaryText = ats(summary) || ats(cv.summary);
  const content: DocDef[] = [];

  if (headline) content.push({ text: headline, ...NAME_STYLE });
  if (contact) content.push({ text: contact, ...CONTACT_STYLE });

  if (summaryText) {
    content.push({ text: "PROFESSIONAL SUMMARY", ...SECTION_HEADER });
    content.push({ text: boldRuns(summaryText), margin: [0, 0, 0, 4] as number[] });
  }

  if (cv.experience.length > 0) {
    content.push({ text: "PROFESSIONAL EXPERIENCE", ...SECTION_HEADER });
    for (const job of cv.experience) {
      const stack: DocDef[] = [];
      if (job.company) stack.push({ text: ats(job.company), ...COMPANY_STYLE });
      if (job.role) stack.push({ text: ats(job.role), ...ROLE_STYLE });
      const meta = jobMetaLine(job);
      if (meta) stack.push({ text: meta, ...JOB_META_STYLE });
      // Bullets stay VERBATIM: no ** promotion, unlike the summary. The user's own
      // asterisks print as asterisks.
      const bullets = job.bullets.map(ats).filter(Boolean);
      if (bullets.length > 0) stack.push({ ul: bullets });
      content.push({ stack, unbreakable: true, margin: BLOCK_MARGIN });
    }
  }

  if (cv.education.length > 0) {
    content.push({ text: "EDUCATION", ...SECTION_HEADER });
    for (const school of cv.education) {
      const stack: DocDef[] = [];
      if (school.school) stack.push({ text: ats(school.school), ...COMPANY_STYLE });
      if (school.degree) stack.push({ text: ats(school.degree), ...ROLE_STYLE });
      const meta = jobMetaLine(school);
      if (meta) stack.push({ text: meta, ...JOB_META_STYLE });
      content.push({ stack, unbreakable: true, margin: BLOCK_MARGIN });
    }
  }

  const skillItems: DocDef[] = [];
  for (const group of cv.skills) {
    const items = group.items.map(ats).filter(Boolean).join(", ");
    if (group.group && items) skillItems.push({ text: [{ text: `${ats(group.group)}: `, bold: true }, { text: items }] });
    else if (items) skillItems.push({ text: items });
    else if (group.group) skillItems.push({ text: ats(group.group) });
  }
  for (const extra of cv.extras.map(ats).filter(Boolean)) skillItems.push({ text: extra });
  if (skillItems.length > 0) {
    content.push({ text: "SKILLS AND ADDITIONAL INFORMATION", ...SECTION_HEADER });
    content.push({ ul: skillItems });
  }

  return {
    pageSize: "A4",
    pageMargins: PAGE_MARGINS,
    defaultStyle: { fontSize: 10.5, lineHeight: 1.3, color: "#1a1a1a" },
    content,
  };
}

/**
 * The tailored CV. A parsed profile renders through the structured layout; anything
 * else falls back to the original verbatim-text render, unchanged.
 */
export function buildCvDoc({
  name,
  summary,
  cvText,
  structured,
}: {
  name: string;
  summary: string;
  cvText: string;
  structured?: CvStructured | null;
}): DocDef {
  if (structured && isCvStructuredUsable(structured)) return buildStructuredCvDoc({ name, summary, cv: structured });
  const body = stripLeadingSummary(cvText);
  return {
    pageSize: "A4",
    pageMargins: PAGE_MARGINS,
    defaultStyle: { fontSize: 10.5, lineHeight: 1.3, color: "#1a1a1a" },
    content: [
      ...(name ? [{ text: name, ...NAME_STYLE }] : []),
      { text: "PROFESSIONAL SUMMARY", ...SECTION_HEADER },
      { text: boldRuns(summary), margin: [0, 0, 0, 4] as number[] },
      { text: "CURRICULUM VITAE", ...SECTION_HEADER },
      // preserveLeadingSpaces keeps the user's own indentation verbatim.
      { text: body, preserveLeadingSpaces: true },
    ],
  };
}

export function buildCoverDoc({ name, company, cover }: { name: string; company: string; cover: CoverJson }): DocDef {
  return {
    pageSize: "A4",
    pageMargins: PAGE_MARGINS,
    defaultStyle: { fontSize: 11, lineHeight: 1.45, color: "#1a1a1a" },
    content: [
      ...(name ? [{ text: name, ...NAME_STYLE }] : []),
      { text: `Cover letter${company ? ` - ${company}` : ""}`, ...META_STYLE },
      // Salutation, then the three body paragraphs, each its own block for even leading.
      { text: cover.greeting, margin: [0, 0, 0, 10] as number[] },
      ...[cover.p1, cover.p2, cover.p3].map((p) => ({ text: p, margin: [0, 0, 0, 10] as number[] })),
      // Sign-off block: visually separated from the body, not just another paragraph.
      { text: cover.sign, margin: [0, 8, 0, 0] as number[] },
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

export async function downloadCvPdf(input: {
  name: string;
  summary: string;
  cvText: string;
  company: string;
  structured?: CvStructured | null;
}): Promise<void> {
  await download(buildCvDoc(input), pdfFilename(input.name, "CV", input.company));
}

export async function downloadCoverPdf(input: { name: string; company: string; cover: CoverJson }): Promise<void> {
  await download(buildCoverDoc(input), pdfFilename(input.name, "Cover letter", input.company));
}
