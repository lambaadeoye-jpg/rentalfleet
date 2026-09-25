import { describe, it, expect } from "vitest";
import { generateFinancialDocumentPdf, generateDamageReportPdf } from "./financial-document";

// A real, valid 1x1 transparent PNG -- minimal but genuinely a PNG, so
// the embed path is actually exercised rather than mocked around.
const MINIMAL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("generateFinancialDocumentPdf", () => {
  it("produces valid PDF bytes (starts with the %PDF signature)", async () => {
    const bytes = await generateFinancialDocumentPdf({
      documentLabel: "RECEIPT",
      businessName: "Test Fleet Rental",
      customerName: "Jordan Rivera",
      rentalReference: "abc12345",
      date: new Date("2026-01-15"),
      lineItems: [{ label: "Weekly rent", amount: 400 }],
      totalLabel: "Amount Paid",
    });

    // Every valid PDF file starts with this exact byte signature --
    // the cheapest, most reliable smoke test that generation actually
    // produced a real PDF rather than silently failing or producing
    // garbage bytes.
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("handles multiple line items without throwing", async () => {
    const bytes = await generateFinancialDocumentPdf({
      documentLabel: "INVOICE",
      businessName: "Test Fleet Rental",
      customerName: "Jordan Rivera",
      rentalReference: "abc12345",
      date: new Date(),
      lineItems: [
        { label: "Toll", amount: 4.5 },
        { label: "Late fee", amount: 25 },
      ],
      totalLabel: "Amount Due",
    });

    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
  });
});

describe("generateDamageReportPdf", () => {
  it("produces valid PDF bytes with no photos (description only)", async () => {
    const bytes = await generateDamageReportPdf({
      businessName: "Test Fleet Rental",
      customerName: "Jordan Rivera",
      rentalReference: "abc12345",
      date: new Date("2026-01-15"),
      description: "Small dent on rear passenger door, approximately 2 inches.",
      photos: [],
    });

    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
  });

  it("embeds a real photo without throwing -- exercises the actual embedPng path, not mocked", async () => {
    const pngBytes = Uint8Array.from(atob(MINIMAL_PNG_BASE64), (c) => c.charCodeAt(0));

    const bytes = await generateDamageReportPdf({
      businessName: "Test Fleet Rental",
      customerName: "Jordan Rivera",
      rentalReference: "abc12345",
      date: new Date(),
      description: "Test damage with a photo attached.",
      linkedChargeAmount: 150,
      photos: [{ bytes: pngBytes, contentType: "image/png" }],
    });

    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    // A PDF with an embedded image is meaningfully larger than one with
    // just text -- a weak but real signal the image actually made it in,
    // not just that generation didn't throw.
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("skips a corrupt photo without failing the whole report", async () => {
    const corruptBytes = new Uint8Array([1, 2, 3, 4, 5]);

    const bytes = await generateDamageReportPdf({
      businessName: "Test Fleet Rental",
      customerName: "Jordan Rivera",
      rentalReference: "abc12345",
      date: new Date(),
      description: "One corrupt photo should not break report generation.",
      photos: [{ bytes: corruptBytes, contentType: "image/jpeg" }],
    });

    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
  });

  it("wraps a long description across multiple lines without throwing", async () => {
    const longDescription =
      "This is a genuinely long damage description that should wrap across several lines in the generated PDF, testing the simple word-wrap logic rather than a short one-liner that would never exercise the wrapping branch at all in this test suite.";

    const bytes = await generateDamageReportPdf({
      businessName: "Test Fleet Rental",
      customerName: "Jordan Rivera",
      rentalReference: "abc12345",
      date: new Date(),
      description: longDescription,
      photos: [],
    });

    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
  });
});
