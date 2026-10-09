// Texting a renter their agreement-signing link. Pure functions, so the wording and the send rules are tested.
// Same safeguards as every other automated text: opt-out list, texting hours by area code, "Reply STOP".

import { isWithinSendWindow } from "./outreach-rules";
import { isValidEmail, toE164 } from "./contact-validation";

export type AgreementSmsDecision =
  | { action: "send"; to: string }
  | { action: "blocked"; code: "no_phone" | "suppressed" | "not_configured" | "quiet_hours"; message: string };

/** Last 10 digits, the same form the opt-out list stores (database normalize_phone). Null if not a US number. */
export function phoneNorm(phone: string | null | undefined): string | null {
  const e = toE164(phone ?? "");
  return e ? e.slice(-10) : null;
}

export function lastFour(phone: string | null | undefined): string | null {
  const n = phoneNorm(phone);
  return n ? n.slice(-4) : null;
}

export function decideAgreementSms(input: { phone: string | null; suppressed: boolean; smsConfigured: boolean; now: Date }): AgreementSmsDecision {
  const to = input.phone ? toE164(input.phone) : null;
  if (!to) return { action: "blocked", code: "no_phone", message: "There is no valid phone number on file for this renter." };
  if (input.suppressed) return { action: "blocked", code: "suppressed", message: "This renter opted out of texts. Create the link and send it another way." };
  if (!input.smsConfigured) return { action: "blocked", code: "not_configured", message: "Texting isn’t set up yet. Create the link and send it yourself." };
  if (!isWithinSendWindow(to, input.now)) return { action: "blocked", code: "quiet_hours", message: "It’s outside texting hours for this number. Try again during the day, or create the link and send it yourself." };
  return { action: "send", to };
}

export function agreementSmsBody(firstName: string | null, url: string, support: string | null): string {
  const hi = firstName?.trim() ? `Hi ${firstName.trim()}, your` : "Your";
  const help = support ? ` Questions? ${support}.` : "";
  return `Zivo: ${hi} rental agreement is ready to review and sign: ${url} The link works for 72 hours.${help} Reply STOP to opt out.`;
}

export type AgreementEmailDecision =
  | { action: "send"; to: string }
  | { action: "blocked"; code: "no_email" | "suppressed" | "not_configured"; message: string };

/** Lower-cased, trimmed address, or null if it isn't a usable email. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e && isValidEmail(e) ? e : null;
}

/** "jo•••@gmail.com" -- enough for staff to confirm the right inbox without showing the whole address. */
export function maskEmail(email: string | null | undefined): string | null {
  const e = normalizeEmail(email);
  if (!e) return null;
  const [name, domain] = e.split("@");
  return `${name.slice(0, 2)}•••@${domain}`;
}

export function decideAgreementEmail(input: { email: string | null; suppressed: boolean; emailConfigured: boolean }): AgreementEmailDecision {
  const to = normalizeEmail(input.email);
  if (!to) return { action: "blocked", code: "no_email", message: "There is no valid email address on file for this renter." };
  if (input.suppressed) return { action: "blocked", code: "suppressed", message: "This renter opted out of emails. Create the link and send it another way." };
  if (!input.emailConfigured) return { action: "blocked", code: "not_configured", message: "Email isn’t set up yet. Create the link and send it yourself." };
  return { action: "send", to };
}
