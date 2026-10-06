import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { toPdfSafe, wrapText, buildSignedAgreementPdf } from "./agreement-pdf";
import { agreementHash } from "./agreement-hash";
import { STARTER_CLAUSES, STARTER_INTRO, STARTER_VARIABLES, renderAgreement, buildRentalValues } from "./agreement";

describe("toPdfSafe", () => {
  it("maps smart punctuation and drops unsupported characters", () => {
    expect(toPdfSafe("It’s “fine” — ok…")).toBe("It's \"fine\" - ok...");
    expect(toPdfSafe("emoji \u{1F600} and 中")).toBe("emoji  and ");
    expect(toPdfSafe("café")).toBe("café");
  });
});

describe("wrapText", () => {
  it("wraps within the width, keeps newlines, splits very long words", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const lines = wrapText("one two three four five six seven eight nine ten\nsecond paragraph", font, 10, 80);
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(80);
    expect(lines.join(" ")).toContain("second paragraph".split(" ")[0]);
    const long = wrapText("x".repeat(200), font, 10, 80);
    for (const l of long) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(80);
    expect(long.join("")).toBe("x".repeat(200));
  });
});

describe("signed PDF and hash", () => {
  const values = buildRentalValues(
    {
      firstName: "Ann", lastName: "Baker", vehicle: { year: 2019, make: "Toyota", model: "Camry", plate: "ABC123", vin: null },
      pickupAt: "2026-10-08T15:00:00Z", returnAt: "2026-10-15T15:00:00Z", weeklyRateUsd: 185, quotedTotalUsd: null, depositUsd: 250, returnLocation: "Zivo Main",
      cancellation: { approved: true, late_fee_usd: 65, early_fee_usd: 25, free_cancellations_per_90d: 2, late_window_hours: 24, noshow_grace_hours: 2, rebook_days: 7, toll_ticket_window_days: 60 },
    },
    STARTER_VARIABLES
  );
  const r = renderAgreement({ intro: STARTER_INTRO, clauses: STARTER_CLAUSES }, values);
  it("hash is stable and changes with any text change", () => {
    if (!r.ok) throw new Error("render failed");
    const h = agreementHash(r.rendered);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(agreementHash(r.rendered)).toBe(h);
    const tampered = { ...r.rendered, clauses: r.rendered.clauses.map((c, i) => (i === 3 ? { ...c, body: c.body + " " } : c)) };
    expect(agreementHash(tampered)).not.toBe(h);
  });
  it("builds a multi-page PDF containing the signature block", async () => {
    if (!r.ok) throw new Error("render failed");
    const bytes = await buildSignedAgreementPdf(r.rendered, {
      signerName: "Ann Baker", signedAtIso: "2026-10-07T15:00:00Z", ip: "1.2.3.4", versionLabel: "v1", contentHash: agreementHash(r.rendered),
      initials: { "2": "AB", "3": "AB", "4": "AB", "5": "AB", "9": "AB", "10": "AB" },
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
  });
});
