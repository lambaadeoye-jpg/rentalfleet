// Pure helpers for document uploads (Phase 3B). Checks what a file REALLY is
// from its first bytes rather than trusting the filename or the browser's
// claimed type, because the upload page is reachable without signing in.

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // stays under hosting request-size limits
export const UPLOAD_DOCUMENT_TYPES = ["drivers_license", "proof_of_residence", "insurance_card"] as const;
export type UploadDocumentType = (typeof UPLOAD_DOCUMENT_TYPES)[number];

export const DOCUMENT_LABELS: Record<string, string> = {
  drivers_license: "Driver's license",
  proof_of_residence: "Proof of residence",
  insurance_card: "Insurance card",
};

export const DOCUMENT_HINTS: Record<string, string> = {
  drivers_license: "Front of your license. Make sure all four corners and the text are visible.",
  proof_of_residence: "A recent utility bill, bank statement or lease with your name and address.",
  insurance_card: "Your current insurance card showing your name and policy dates.",
};

export type SniffedType = "jpeg" | "png" | "webp" | "heic" | "pdf";

const EXT: Record<SniffedType, string> = { jpeg: "jpg", png: "png", webp: "webp", heic: "heic", pdf: "pdf" };
const MIME: Record<SniffedType, string> = {
  jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", pdf: "application/pdf",
};
export const extensionFor = (t: SniffedType) => EXT[t];
export const mimeFor = (t: SniffedType) => MIME[t];

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...Array.from(b.slice(from, to)));

export function sniffFileType(b: Uint8Array): SniffedType | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return "png";
  if (ascii(b, 0, 4) === "%PDF") return "pdf";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (ascii(b, 4, 8) === "ftyp" && ["heic", "heix", "hevc", "mif1", "msf1", "heim", "heis"].includes(ascii(b, 8, 12))) return "heic";
  return null;
}

export type UploadCheck = { ok: true; type: SniffedType } | { ok: false; error: string };

export function checkUpload(size: number, firstBytes: Uint8Array): UploadCheck {
  if (!size || size <= 0) return { ok: false, error: "Choose a file first." };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, error: "That file is too large (max 5 MB). Try a smaller photo." };
  const type = sniffFileType(firstBytes);
  if (!type) return { ok: false, error: "Please upload a photo (JPG, PNG, HEIC) or a PDF." };
  return { ok: true, type };
}

export function isUploadDocumentType(t: string): t is UploadDocumentType {
  return (UPLOAD_DOCUMENT_TYPES as readonly string[]).includes(t);
}

/** Link tokens are 32 random bytes, base64url (43 chars). Reject anything else before touching the database. */
export const UPLOAD_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function reviewBadge(status: string | null | undefined): { text: string; tone: "ok" | "warn" | "wait" } {
  if (status === "accepted") return { text: "Approved", tone: "ok" };
  if (status === "rejected") return { text: "Needs a redo", tone: "warn" };
  return { text: "Received, under review", tone: "wait" };
}

const UPLOAD_ERRORS: Record<string, string> = {
  link_invalid: "This link has expired or is no longer active. Ask us for a new one.",
  type_not_allowed: "That document isn't part of this request.",
  upload_limit: "Too many uploads on this link. Please contact us.",
};
export function uploadErrorMessage(message: string | null | undefined): string {
  if (message) for (const [code, text] of Object.entries(UPLOAD_ERRORS)) if (message.includes(code)) return text;
  return "Upload failed. Please try again.";
}
