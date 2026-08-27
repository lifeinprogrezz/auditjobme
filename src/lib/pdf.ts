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
//    structure, so the same profile prints the same document every time. The one
//    layout choice the owner gets is groupedIntoPrevious: an entry marked in the
//    editor prints its bullets under the entry above it (foldGroupedExperience).
//  - TEXT (fallback, unchanged): cv_text printed verbatim, whitespace preserved, for
//    a profile that has not been parsed yet.
import { stripLeadingSummary } from "./cvHtml";
import { isCvStructuredUsable, normalizeForAts, type CvExperience, type CvStructured } from "./cvStructured";
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

// Letterhead + section-header treatment for the unparsed-text CV fallback (the
// cover letter now shares the structured CV's own letterhead below — issue #151).
// Presentation only — no color blocks, no rules, one typeface family.
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

// ─── Structured CV typography: the personal engine's stylesheet, unit for unit ──────
// Source: career-ops lib/tailor-cv.mjs SHARED_CV_CSS (Arial/Helvetica, 11pt body on a
// 1.42 line height, black, no colour tint and no letter-spacing on headings). Font
// sizes carry over as points. The engine's pixel margins convert at the CSS print
// ratio, 1px = 0.75pt, so the page keeps the same rhythm as the engine's HTML print.
/** CSS pixels (the engine's margin unit) to PDF points. */
const px = (n: number): number => n * 0.75;
/** PDF standard font — no embedded file, registered at download time (see download()). */
export const CV_FONT = "Helvetica";
const CV_DEFAULT_STYLE = { font: CV_FONT, fontSize: 11, lineHeight: 1.42, color: "#000" };
/** h1: the applicant's full name. */
const CV_NAME_STYLE = { fontSize: 20, bold: true, margin: [0, 0, 0, px(10)] as number[] };
/** .contact p: one item per line, label bold. */
const CONTACT_LINE_STYLE = { fontSize: 11 };
/** .contact a: coloured, underlined, clickable. */
const LINK_STYLE = { color: "#1155cc", decoration: "underline" };
/** h2: 13pt bold UPPERCASE, margin-top 20px, margin-bottom 9px. */
const CV_SECTION_HEADER = { fontSize: 13, bold: true, margin: [0, px(20), 0, px(9)] as number[] };
/** h3: company / school name. Its 13px top margin is applied per block (blockMargin). */
const COMPANY_STYLE = { fontSize: 11, bold: true };
/** .role: job title / degree. */
const ROLE_STYLE = { fontSize: 11, bold: true };
/** .meta: "dates | location" (11pt regular, black, per the owner's brief). */
const JOB_META_STYLE = { fontSize: 11, margin: [0, 0, 0, px(5)] as number[] };
/** li: margin-bottom 3px between bullets. */
const BULLET_MARGIN = [0, 0, 0, px(3)] as number[];

/**
 * One job or one degree, kept off a page seam so a heading never strands its bullets.
 * The engine's h3 carries margin-top 13px; CSS collapses it with the h2's 9px bottom
 * margin for the FIRST block of a section, so that one only adds the difference.
 */
function blockMargin(index: number): number[] {
  return [0, index === 0 ? px(13) - px(9) : px(13), 0, 0];
}

/** Every printed string goes through applicant-tracking-system normalisation. */
const ats = (text: string): string => normalizeForAts(text || "").trim();

/** "09/2021 - Present | Barcelona, Spain" from whichever parts the CV actually had. */
export function jobMetaLine(job: { start?: string; end?: string; location?: string }): string {
  const dates = [ats(job.start ?? ""), ats(job.end ?? "")].filter(Boolean).join(" - ");
  return [dates, ats(job.location ?? "")].filter(Boolean).join(" | ");
}

// ─── Cover letter dateline (issue #151 / D2) ─────────────────────────────────
const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "26 August 2026" — the engine's English date format (career-ops tailor-cv.mjs
 *  formatDateEN), spelled out for a letter rather than a numeric date. */
export function formatDateEN(date: Date): string {
  return `${date.getDate()} ${MONTHS_EN[date.getMonth()]} ${date.getFullYear()}`;
}

/** "Barcelona, 26 August 2026" — the engine's letter dateline, city from the
 *  contact location (the part before the first comma). Falls back to the bare
 *  date when there is no location on file, rather than inventing one. */
export function coverDateLine(location: string | undefined | null, date: Date): string {
  const city = ats(location ?? "").split(",")[0].trim();
  const formatted = formatDateEN(date);
  return city ? `${city}, ${formatted}` : formatted;
}
const COVER_DATE_STYLE = { fontSize: 11, margin: [0, px(14), 0, px(18)] as number[] };

/** One line of the contact block: "Label: text", the text a link when `link` is set. */
export type ContactLine = { label: string; text: string; link?: string };

/** A link as the CV wrote it ("linkedin.com/in/jane") becomes a clickable https URL. */
export function linkHref(url: string): string {
  const trimmed = url.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** The engine's link labels, by host: linkedin.com → LinkedIn, github.com → GitHub, else Portfolio. */
export function linkLabel(url: string): "LinkedIn" | "GitHub" | "Portfolio" {
  let host = "";
  try {
    host = new URL(linkHref(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "Portfolio";
  }
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "LinkedIn";
  if (host === "github.com" || host.endsWith(".github.com")) return "GitHub";
  return "Portfolio";
}

/**
 * The engine's multi-line contact block, in its order: Location · Mobile · Email ·
 * Portfolio · GitHub · LinkedIn. Only a line whose data exists is rendered. (The
 * engine's Nationality line has no field in cv_structured.contact, so it never prints.)
 */
export function contactLines(contact: CvStructured["contact"]): ContactLine[] {
  const lines: ContactLine[] = [];
  const location = ats(contact.location ?? "");
  const phone = ats(contact.phone ?? "");
  const email = ats(contact.email ?? "");
  if (location) lines.push({ label: "Location", text: location });
  if (phone) lines.push({ label: "Mobile", text: phone });
  if (email) lines.push({ label: "Email", text: email, link: `mailto:${email}` });
  const links = contact.links.map(ats).filter(Boolean);
  for (const label of ["Portfolio", "GitHub", "LinkedIn"] as const) {
    for (const url of links) {
      if (linkLabel(url) === label) lines.push({ label, text: url, link: linkHref(url) });
    }
  }
  return lines;
}

/** pdfmake text for one contact line: bold label, then the value (a link when it is one). */
function contactItem({ label, text, link }: ContactLine): DocDef {
  const value: DocDef = link ? { text, link, ...LINK_STYLE } : { text };
  return { text: [{ text: `${label}: `, bold: true }, value], ...CONTACT_LINE_STYLE };
}

/** A real bullet list with the engine's 3px gap between items. */
function bulletList(items: DocDef[]): DocDef {
  return { ul: items.map((item) => ({ ...item, margin: BULLET_MARGIN })) };
}

/** One printed experience block: the entry that carries the heading, plus every bullet under it. */
export type CvExperienceBlock = { head: CvExperience; bullets: string[] };

/**
 * Fold the entries the owner marked into the entry above them.
 *
 * A CV can give a side project its own title and dates, so the parse reads it as a
 * job. That is correct: the parse mirrors the CV. Only the owner can say the entry
 * really belongs under the one above, and they say it in the editor. The flag moves
 * BULLETS and nothing else: the marked entry's bullets join the parent's list, in
 * order, verbatim, and its own company, role and dates are not printed. No text is
 * written, merged or reworded. Two marked entries in a row both land in the nearest
 * unmarked entry above them. An unmarked profile comes through untouched, so it
 * builds exactly the document it built before this existed.
 */
export function foldGroupedExperience(experience: CvExperience[]): CvExperienceBlock[] {
  const blocks: CvExperienceBlock[] = [];
  for (const job of experience) {
    const parent = blocks.at(-1);
    // The first entry always opens a block: there is nothing above it to join.
    if (parent && job.groupedIntoPrevious === true) parent.bullets.push(...job.bullets);
    else blocks.push({ head: job, bullets: [...job.bullets] });
  }
  return blocks;
}

/**
 * The deterministic CV: the personal engine's layout, built from the parsed profile.
 * Pure — same structure in, byte-identical document definition out (pinned in
 * pdf.test.ts). The tailored summary REPLACES the summary the CV came with, so the
 * old one can never print twice.
 */
export function buildStructuredCvDoc({ name, summary, cv }: { name: string; summary: string; cv: CvStructured }): DocDef {
  const headline = ats(cv.contact.name || name);
  const contact = contactLines(cv.contact);
  const summaryText = ats(summary) || ats(cv.summary);
  const content: DocDef[] = [];

  if (headline) content.push({ text: headline, ...CV_NAME_STYLE });
  if (contact.length > 0) content.push({ stack: contact.map(contactItem) });

  if (summaryText) {
    content.push({ text: "PROFESSIONAL SUMMARY", ...CV_SECTION_HEADER });
    content.push({ text: boldRuns(summaryText) });
  }

  // Blocks, not entries: an entry the owner marked prints inside the one above it.
  const experienceBlocks = foldGroupedExperience(cv.experience);
  if (experienceBlocks.length > 0) {
    content.push({ text: "PROFESSIONAL EXPERIENCE", ...CV_SECTION_HEADER });
    experienceBlocks.forEach(({ head: job, bullets: raw }, i) => {
      const stack: DocDef[] = [];
      if (job.company) stack.push({ text: ats(job.company), ...COMPANY_STYLE });
      if (job.role) stack.push({ text: ats(job.role), ...ROLE_STYLE });
      const meta = jobMetaLine(job);
      if (meta) stack.push({ text: meta, ...JOB_META_STYLE });
      // Bullets stay VERBATIM: no ** promotion, unlike the summary. The user's own
      // asterisks print as asterisks.
      const bullets = raw.map(ats).filter(Boolean);
      if (bullets.length > 0) stack.push(bulletList(bullets.map((text) => ({ text }))));
      content.push({ stack, unbreakable: true, margin: blockMargin(i) });
    });
  }

  if (cv.education.length > 0) {
    content.push({ text: "EDUCATION", ...CV_SECTION_HEADER });
    cv.education.forEach((school, i) => {
      const stack: DocDef[] = [];
      if (school.school) stack.push({ text: ats(school.school), ...COMPANY_STYLE });
      if (school.degree) stack.push({ text: ats(school.degree), ...ROLE_STYLE });
      const meta = jobMetaLine(school);
      if (meta) stack.push({ text: meta, ...JOB_META_STYLE });
      content.push({ stack, unbreakable: true, margin: blockMargin(i) });
    });
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
    content.push({ text: "SKILLS & ADDITIONAL INFORMATION", ...CV_SECTION_HEADER });
    content.push(bulletList(skillItems));
  }

  return {
    pageSize: "A4",
    pageMargins: PAGE_MARGINS,
    defaultStyle: CV_DEFAULT_STYLE,
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

/**
 * The cover letter: the SAME letterhead as the structured CV (issue #151 / D2) —
 * name in CV_NAME_STYLE, the contactLines block when there is a parsed contact —
 * then a dateline in the contact's city, then the salutation, the three body
 * paragraphs, and the sign-off. `contact` is optional: a profile that has not
 * been parsed yet (buildCvDoc's text fallback) still gets a name and a dateline,
 * just no contact block.
 */
export function buildCoverDoc({
  name,
  cover,
  contact,
  date = new Date(),
}: {
  name: string;
  /** Kept for the download filename (pdfFilename) — no longer printed as a body caption. */
  company?: string;
  cover: CoverJson;
  contact?: CvStructured["contact"] | null;
  date?: Date;
}): DocDef {
  const headline = ats(contact?.name || name);
  const contactBlock = contact ? contactLines(contact) : [];
  const content: DocDef[] = [];
  if (headline) content.push({ text: headline, ...CV_NAME_STYLE });
  if (contactBlock.length > 0) content.push({ stack: contactBlock.map(contactItem) });
  content.push({ text: coverDateLine(contact?.location, date), ...COVER_DATE_STYLE });
  // Salutation, then the three body paragraphs, each its own block for even leading.
  content.push({ text: cover.greeting, margin: [0, 0, 0, 10] as number[] });
  content.push(...[cover.p1, cover.p2, cover.p3].map((p) => ({ text: p, margin: [0, 0, 0, 10] as number[] })));
  // Sign-off block: visually separated from the body, not just another paragraph.
  content.push({ text: cover.sign, margin: [0, 8, 0, 0] as number[] });
  return { pageSize: "A4", pageMargins: PAGE_MARGINS, defaultStyle: CV_DEFAULT_STYLE, content };
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
  const [{ default: pdfMake }, { default: vfsFonts }, { default: helvetica }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
    import("pdfmake/build/standard-fonts/Helvetica"),
  ]);
  // Roboto (embedded) for the unparsed-text CV fallback; Helvetica — a PDF standard
  // font, metrics only, no font file — for the structured CV AND the cover letter,
  // which now shares its letterhead (CV_FONT, issue #151).
  pdfMake.addVirtualFileSystem(vfsFonts);
  pdfMake.addFontContainer(helvetica);
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

export async function downloadCoverPdf(input: {
  name: string;
  company: string;
  cover: CoverJson;
  contact?: CvStructured["contact"] | null;
  date?: Date;
}): Promise<void> {
  await download(buildCoverDoc(input), pdfFilename(input.name, "Cover letter", input.company));
}
