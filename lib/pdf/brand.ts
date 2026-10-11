import type { PDFDocument, PDFPage } from "pdf-lib";
import { LOGO_ONECOLOR_ASPECT, LOGO_ONECOLOR_PNG_BASE64 } from "../brand-assets";

/** Minimum logo width in PDF points (1.5in print minimum from the logo guide = 108pt). */
export const MIN_PDF_LOGO_WIDTH = 108;

/**
 * Draws the one-color Zivo logo with its top-left at (x, topY). Returns the height drawn so callers can move down.
 * One-color navy is the guide's variant for agreements, invoices and low-colour print.
 */
export async function drawBrandLogo(pdf: PDFDocument, page: PDFPage, x: number, topY: number, width = 120): Promise<number> {
  const w = Math.max(MIN_PDF_LOGO_WIDTH, width);
  const h = w / LOGO_ONECOLOR_ASPECT;
  const img = await pdf.embedPng(Buffer.from(LOGO_ONECOLOR_PNG_BASE64, "base64"));
  page.drawImage(img, { x, y: topY - h, width: w, height: h });
  return h;
}
