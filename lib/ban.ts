// The do-not-rent list. Matches by phone or email, so a new sign-up can't get around a ban.
import { phoneNorm, normalizeEmail } from "./agreement-notice";

export const MIN_REASON = 5;

export function banKeys(phone: string | null | undefined, email: string | null | undefined): { phoneNorm: string | null; email: string | null } {
  return { phoneNorm: phoneNorm(phone), email: normalizeEmail(email) };
}

export function validateBanReason(text: string): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = text.trim().replace(/\s+/g, " ").slice(0, 300);
  if (reason.length < MIN_REASON) return { ok: false, error: "Write a short reason, so the decision can be explained later." };
  return { ok: true, reason };
}

/** Shown to a banned applicant. Deliberately gives no reason and no way to probe the list. */
export const BANNED_APPLICANT_MESSAGE = "We’re not able to take this application. Please contact us if you think this is a mistake.";
