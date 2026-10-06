import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { RenderedAgreement } from "./agreement";

// Built-in PDF fonts only draw basic Latin characters; anything else would make
// pdf-lib throw. Map common typographic characters, drop the rest.
export function toPdfSafe(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[^\x09\x0A\x20-\x7E¡-ÿ]/g, "");
}

/** Greedy word wrap using real font metrics. Honors explicit newlines; splits words longer than a line. */
export function wrapText(text: string, font: Pick<PDFFont, "widthOfTextAtSize">, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(""); continue; }
    let line = "";
    const flush = () => { if (line) { lines.push(line); line = ""; } };
    for (let word of words) {
      while (font.widthOfTextAtSize(word, size) > maxWidth) {
        let cut = word.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > maxWidth) cut--;
        flush();
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
      else { flush(); line = word; }
    }
    flush();
  }
  return lines;
}

export type SignatureEvidence = {
  signerName: string;
  signedAtIso: string;
  ip: string;
  versionLabel: string;
  contentHash: string;
  initials: Record<string, string>;
};

export async function buildSignedAgreementPdf(agreement: RenderedAgreement, ev: SignatureEvidence): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.043, 0.071, 0.125);
  const muted = rgb(0.4, 0.44, 0.53);
  const W = 612, H = 792, M = 54, maxW = W - 2 * M;

  let page = pdf.addPage([W, H]);
  let y = H - M;
  const ensure = (need: number) => { if (y - need < M + 20) { page = pdf.addPage([W, H]); y = H - M; } };
  const write = (text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.bold ? bold : font;
    for (const line of wrapText(toPdfSafe(text), f, size, maxW)) {
      ensure(size + 4);
      if (line) page.drawText(line, { x: M, y: y - size, size, font: f, color: opts.color ?? ink });
      y -= size + 4;
    }
    y -= opts.gap ?? 0;
  };

  write("Zivo Mobility LLC", { size: 16, bold: true });
  write("Vehicle Rental Agreement", { size: 11, bold: true, color: muted, gap: 10 });
  write(agreement.intro, { gap: 8 });
  for (const c of agreement.clauses) {
    write(`${c.number}. ${c.title}${c.initial ? "  (initialed)" : ""}`, { bold: true, size: 10.5 });
    write(c.body, { gap: 6 });
  }

  ensure(150);
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: muted });
  y -= 14;
  write("Electronic signature", { bold: true, size: 11 });
  write(`Signed by: ${ev.signerName}`);
  write(`Date and time: ${new Date(ev.signedAtIso).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "long", timeStyle: "long" })}`);
  write(`IP address: ${ev.ip}`);
  write(`Agreement version: ${ev.versionLabel}`);
  const initialsLine = Object.keys(ev.initials).sort((a, b) => Number(a) - Number(b)).map((k) => `clause ${k}: ${ev.initials[k]}`).join(",  ");
  write(`Initials recorded: ${initialsLine || "none required"}`);
  write(`Document fingerprint (SHA-256): ${ev.contentHash}`, { size: 8, color: muted });

  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 60, y: 28, size: 8, font, color: muted }));
  return pdf.save();
}
