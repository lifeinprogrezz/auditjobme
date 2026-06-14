import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Extract plain text from a PDF file entirely client-side (no LLM, deterministic).
 * Joins text items on a page with spaces and separates pages with blank lines.
 * Throws a clear Error if the file can't be read or parsed as a PDF.
 */
export async function extractPdfText(file: File): Promise<string> {
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new Error("Could not read the file. Try again.");
  }

  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  } catch {
    throw new Error("That doesn't look like a readable PDF. Make sure it's a real PDF, not a scan or image.");
  }

  try {
    const pages: string[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim();
      if (pageText) pages.push(pageText);
    }
    const text = pages.join("\n\n").trim();
    if (!text) {
      throw new Error("No text found in that PDF. It may be a scanned image — paste the text instead.");
    }
    return text;
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("Could not extract text from that PDF. Paste the text instead.");
  }
}
