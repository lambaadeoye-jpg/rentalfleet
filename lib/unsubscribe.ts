import { createHmac, timingSafeEqual } from "crypto";

// One-click email unsubscribe. The link carries the address plus a signature, so nobody can unsubscribe
// someone else by guessing. The signing key is derived from AUTOMATION_API_SECRET (no extra setting).

// Signing uses UNSUBSCRIBE_SECRET when set, otherwise the first AUTOMATION_API_SECRET. Verifying accepts
// any of them, so rotating the automation secret does not break links already sent in emails.
function keys(): string[] {
  const out: string[] = [];
  if (process.env.UNSUBSCRIBE_SECRET) out.push(`unsub-v1:${process.env.UNSUBSCRIBE_SECRET}`);
  for (const s of (process.env.AUTOMATION_API_SECRET ?? "").split(",").map((x) => x.trim()).filter(Boolean)) out.push(`unsub-v1:${s}`);
  return out;
}
function key(): string | null {
  return keys()[0] ?? null;
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
  const ks = keys();
  if (ks.length === 0 || typeof token !== "string" || token.length > 600) return null;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  let email: string;
  try {
    email = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!email || !email.includes("@")) return null;
  const got = Buffer.from(sig);
  for (const k of ks) {
    const want = Buffer.from(sign(email, k));
    if (want.length === got.length && timingSafeEqual(want, got)) return email;
  }
  return null;
}

export function unsubscribeUrl(base: string, email: string): string | null {
  const t = makeUnsubscribeToken(email);
  return t ? `${base.replace(/\/$/, "")}/unsubscribe?t=${encodeURIComponent(t)}` : null;
}

export function maskEmail(email: string): string {
  const [u, d] = email.split("@");
  return `${u.slice(0, 1)}${"*".repeat(Math.max(1, Math.min(u.length - 1, 6)))}@${d}`;
}
