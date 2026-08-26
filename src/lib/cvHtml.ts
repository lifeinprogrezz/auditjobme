// src/lib/cvHtml.ts — the one shared piece of CV text handling that is not printing.
//
// This module used to build CV and cover-letter HTML for a Chromium print path. That
// path was replaced by the pdfmake documents in pdf.ts and the HTML builders had no
// caller left but their own tests, so they are gone (#150). What remains is the
// summary-deduplication rule, which the plain-text render still needs.

/**
 * Conservatively strip a LEADING summary/profile block so it does not duplicate the tailored
 * summary we prepend. Only strips when the first non-empty line is clearly a summary heading
 * (e.g. "Summary", "Professional Summary", "Profile", "About", "Objective"); otherwise returns
 * cvText UNCHANGED. Verbatim wins whenever there is any doubt — we never risk dropping content.
 */
export function stripLeadingSummary(cvText: string): string {
  const lines = (cvText || "").split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return cvText;
  const head = lines[i].trim().replace(/^#+\s*/, "").replace(/[:*_#]/g, "").trim().toLowerCase();
  const isSummaryHeading = head.length <= 40 && /^(professional\s+)?(summary|profile|about( me)?|objective)$/.test(head);
  if (!isSummaryHeading) return cvText;
  // Drop from the heading through the following paragraph, up to the next blank line.
  let j = i + 1;
  while (j < lines.length && lines[j].trim() !== "") j++;
  while (j < lines.length && lines[j].trim() === "") j++;
  return lines.slice(j).join("\n").replace(/^\n+/, "");
}
