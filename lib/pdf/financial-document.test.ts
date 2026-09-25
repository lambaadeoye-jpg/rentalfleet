import { describe, it, expect } from "vitest";
import { generateFinancialDocumentPdf } from "./financial-document";

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
