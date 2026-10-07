import { createHmac, timingSafeEqual } from "crypto";

// One-click email unsubscribe. The link carries the address plus a signature, so nobody can unsubscribe
// someone else by guessing. The signing key is derived from AUTOMATION_API_SECRET (no extra setting).

function key(): string | null {
  const s = process.env.AUTOMATION_API_SECRET;
  return s ? `unsub-v1:${s}` : null;
}

function sign(email: string, k: string): string {
  return createHmac("sha256", k).update(email).digest("base64url");
}

export function makeUnsubscribeToken(email: string): string | null {
  const k = key();
  const e = email.trim().toLowerCase();
  if (!k || !e) return null;
  return `${Buffer.from(e, "utf8").toString("base64url")}.${sign(e, k)}`;
}

/** Returns the address if the token is genuine, otherwise null. */
export function verifyUnsubscribeToken(token: string): string | null {
  const k = key();
  if (!k || typeof token !== "string" || token.length > 600) return null;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  let email: string;
  try {
    email = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!email || !email.includes("@")) return null;
  const want = Buffer.from(sign(email, k));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return email;
}

export function unsubscribeUrl(base: string, email: string): string | null {
  const t = makeUnsubscribeToken(email);
  return t ? `${base.replace(/\/$/, "")}/unsubscribe?t=${encodeURIComponent(t)}` : null;
}

export function maskEmail(email: string): string {
  const [u, d] = email.split("@");
  return `${u.slice(0, 1)}${"*".repeat(Math.max(1, Math.min(u.length - 1, 6)))}@${d}`;
}
