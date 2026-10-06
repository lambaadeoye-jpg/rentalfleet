import { randomBytes, createHash } from "node:crypto";

// Server-only. The raw token exists only in the link given to the renter; the
// database keeps just its SHA-256 hash, so a database leak can't be turned
// into working upload links.
export function hashUploadToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateUploadToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashUploadToken(token) };
}

export function uploadLinkUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://rentzivo.com").replace(/\/$/, "");
  return `${base}/upload/${token}`;
}
