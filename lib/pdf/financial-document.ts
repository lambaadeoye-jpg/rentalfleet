import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Shared PDF generation for receipts, invoices, and (later) damage
// reports -- one file since all three share the same header/footer
// shape and just differ in what fills the body. No logo yet -- there's
// a clearly marked slot below where it drops in once a real logo asset
// exists; leaving it out entirely for now rather than guessing at a
// placeholder graphic.

export type DocumentLineItem = { label: string; amount: number };

export async function generateFinancialDocumentPdf(params: {
  documentLabel: "RECEIPT" | "INVOICE";
  businessName: string;
  customerName: string;
  rentalReference: string;
  date: Date;
  lineItems: DocumentLineItem[];
  totalLabel: string;
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // US Letter
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const midnight = rgb(0.043, 0.071, 0.125); // #0B1220
  const teal = rgb(0, 0.663, 0.612); // #00A99D
  const muted = rgb(0.4, 0.44, 0.53); // #667085

  let y = 740;

  // --- Header ---
  // LOGO SLOT: once a real logo asset exists, embed it here with
  // pdfDoc.embedPng()/embedJpg() and page.drawImage() before the
  // business name, e.g.:
  //   const logoBytes = await fetch(logoUrl).then(r => r.arrayBuffer());
  //   const logoImage = await pdfDoc.embedPng(logoBytes);
  //   page.drawImage(logoImage, { x: 50, y: y - 10, width: 40, height: 40 });
  page.drawText(params.businessName, { x: 50, y, size: 20, font: boldFont, color: midnight });
  y -= 18;
  page.drawText(params.documentLabel, { x: 50, y, size: 11, font: boldFont, color: teal });
  y -= 40;

  // --- Meta ---
  page.drawText(`Date: ${params.date.toLocaleDateString()}`, { x: 50, y, size: 10, font, color: muted });
  page.drawText(`Rental: ${params.rentalReference}`, { x: 320, y, size: 10, font, color: muted });
  y -= 16;
  page.drawText(`Renter: ${params.customerName}`, { x: 50, y, size: 10, font, color: muted });
  y -= 30;

  // --- Divider ---
  page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 1, color: rgb(0.89, 0.91, 0.93) });
  y -= 24;

  // --- Line items ---
  let total = 0;
  for (const item of params.lineItems) {
    page.drawText(item.label, { x: 50, y, size: 11, font, color: midnight });
    page.drawText(`$${item.amount.toFixed(2)}`, { x: 480, y, size: 11, font, color: midnight });
    total += item.amount;
    y -= 22;
  }

  y -= 10;
  page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 1, color: rgb(0.89, 0.91, 0.93) });
  y -= 24;

  page.drawText(params.totalLabel, { x: 50, y, size: 13, font: boldFont, color: midnight });
  page.drawText(`$${total.toFixed(2)}`, { x: 480, y, size: 13, font: boldFont, color: teal });

  // --- Footer ---
  page.drawText("Thank you for renting with us.", { x: 50, y: 60, size: 9, font, color: muted });

  return pdfDoc.save();
}
