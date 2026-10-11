import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { existsSync } from "node:fs";
import { LOGO_ONECOLOR_ASPECT, LOGO_ONECOLOR_PNG_BASE64, EMAIL_LOGO_HTML } from "./brand-assets";
import { drawBrandLogo, MIN_PDF_LOGO_WIDTH } from "./pdf/brand";
import { logoSize, logoSrc, MIN_LOGO_WIDTH } from "../app/brand-logo";

describe("brand logo", () => {
  it("every logo file the component points at exists", () => {
    for (const v of ["primary", "white", "onecolor", "symbol"] as const) {
      expect(existsSync(`public${logoSrc(v)}`)).toBe(true);
    }
  });

  it("enforces the 120px minimum on the wordmark, never stretches, and exempts the symbol", () => {
    expect(logoSize("primary", 60).width).toBe(MIN_LOGO_WIDTH);
    const s = logoSize("primary", 240);
    expect(s.height).toBe(Math.round((240 * 183) / 720));
    expect(logoSize("symbol", 32).width).toBe(32);
  });

  it("embeds the one-color logo in a PDF at no less than the 1.5in print minimum", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const h = await drawBrandLogo(pdf, page, 50, 740, 40);
    expect(h).toBeCloseTo(MIN_PDF_LOGO_WIDTH / LOGO_ONECOLOR_ASPECT, 5);
    expect(LOGO_ONECOLOR_PNG_BASE64.length).toBeGreaterThan(1000);
    expect((await pdf.save()).length).toBeGreaterThan(1000);
  });

  it("the email logo header has fixed dimensions and alt text", () => {
    expect(EMAIL_LOGO_HTML).toContain('alt="Zivo"');
    expect(EMAIL_LOGO_HTML).toContain('width="140"');
    expect(EMAIL_LOGO_HTML).toContain("/brand/logo.png");
  });
});
