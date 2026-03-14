/**
 * PDF upload handler: extracts text from an uploaded PDF file using pdf-parse.
 *
 * If the PDF contains only images (scanned document) with no extractable text,
 * an error is thrown so the caller can fall back or report the issue.
 */
export async function extractPdfText(file: File): Promise<string> {
  // Dynamic import to avoid loading pdf-parse when not needed
  const { PDFParse } = await import("pdf-parse");
  const buffer = Buffer.from(await file.arrayBuffer());
  const pdf = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await pdf.getText();
  const text = result.text?.trim();
  await pdf.destroy();
  if (!text) {
    throw new Error("PDF appears to contain only images or no extractable text.");
  }
  return text;
}
