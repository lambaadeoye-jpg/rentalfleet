import { createHash } from "node:crypto";

// Failed-verification lockout for the Front Desk voice assistant.
//
// Verification is phone (supplied by the carrier, not the model) plus the
// email on file. Without a limit, someone spoofing a renter's number could
// guess emails indefinitely. Failures are keyed by a hash of the caller's
// last 10 digits (so +1 / formatted / raw forms all count together, and no
// raw number is stored in the event payload) and counted from the
// communication_event log, so the limit holds across serverless instances.

export const MAX_FAILED_VERIFICATIONS = 3;
export const LOCKOUT_WINDOW_MINUTES = 60;

export function callerKey(phone: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return createHash("sha256").update(digits.slice(-10)).digest("hex").slice(0, 16);
}

export function isLockedOut(recentFailures: number): boolean {
  return recentFailures >= MAX_FAILED_VERIFICATIONS;
}
