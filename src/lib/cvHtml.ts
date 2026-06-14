// src/lib/cvHtml.ts — deterministic CV + cover-letter HTML for the apply bundle.
//
// THE TRUST RULE: the CV BODY is the user's cv_text rendered VERBATIM — escaped for HTML
// and with whitespace preserved, but never reordered, reworded, or dropped. No LLM touches
// it. Only the tailored Professional Summary (from tailor.ts) is prepended. This generalizes
// career-ops lib/tailor-cv.mjs for any user (no hardcoded identity).
import type { CoverJson } from "./tailor";

export function esc(text: string): string {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function boldify(text: string): string {
  // escape first, then promote **markers** to <strong> — never trusts raw HTML
  return esc(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

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

const CV_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.45; color: #1a1a1a; background: #fff; }
  .page { max-width: 720px; margin: 0 auto; padding: 8px; }
  h1 { font-size: 20pt; font-weight: 700; margin-bottom: 10px; }
  h2 { font-size: 12.5pt; font-weight: 700; margin-top: 20px; margin-bottom: 8px; text-transform: uppercase; color: #4a5a4a; border-bottom: 1px solid #8a9a8a; padding-bottom: 2px; }
  .summary { font-size: 10.5pt; line-height: 1.5; margin-top: 4px; }
  .cv-body { font-size: 10.5pt; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; }
`.trim();

const COVER_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.55; color: #1a1a1a; background: #fff; }
  .page { max-width: 720px; margin: 0 auto; padding: 8px; }
  h1 { font-size: 19pt; font-weight: 700; margin-bottom: 4px; }
  .meta { font-size: 10pt; color: #4a5a4a; margin-bottom: 20px; }
  p.body { margin-bottom: 12px; font-size: 11pt; }
  .sign { margin-top: 16px; font-size: 11pt; }
`.trim();

/**
 * Tailored CV: tailored summary (LLM) + the user's cv_text body VERBATIM.
 * Invariant: esc(stripLeadingSummary(cvText)) appears verbatim in the output.
 */
export function buildCvHtml({ name, summary, cvText }: { name: string; summary: string; cvText: string }): string {
  const body = esc(stripLeadingSummary(cvText));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(name) || "Curriculum Vitae"} - CV</title>
<style>${CV_CSS}</style>
</head>
<body>
<div class="page">
${name ? `<h1>${esc(name)}</h1>` : ""}
<h2>Professional Summary</h2>
<p class="summary">${boldify(summary)}</p>
<h2>Curriculum Vitae</h2>
<div class="cv-body">${body}</div>
</div>
</body>
</html>`;
}

export function buildCoverHtml({ name, company, cover }: { name: string; company: string; cover: CoverJson }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(name) || "Cover Letter"} - Cover Letter</title>
<style>${COVER_CSS}</style>
</head>
<body>
<div class="page">
${name ? `<h1>${esc(name)}</h1>` : ""}
<div class="meta">Cover letter${company ? ` — ${esc(company)}` : ""}</div>
<p class="body">${esc(cover.greeting)}</p>
<p class="body">${esc(cover.p1)}</p>
<p class="body">${esc(cover.p2)}</p>
<p class="body">${esc(cover.p3)}</p>
<p class="sign">${esc(cover.sign)}</p>
</div>
</body>
</html>`;
}
