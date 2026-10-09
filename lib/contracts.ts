// What state is a rental's agreement in? Pure logic for the Contracts page.

export type AgreementState = "signed" | "waiting" | "expired" | "revoked" | "not_sent";

export const STATE_LABELS: Record<AgreementState, string> = {
  signed: "Signed",
  waiting: "Waiting for signature",
  expired: "Link expired",
  revoked: "Link cancelled",
  not_sent: "Not sent",
};

export type SignRequestLite = { createdAt: string; expiresAt: string; signedAt: string | null; revokedAt: string | null };

export function agreementState(input: { signed: boolean; requests: SignRequestLite[] }, now: Date = new Date()): AgreementState {
  if (input.signed) return "signed";
  if (input.requests.length === 0) return "not_sent";
  const latest = [...input.requests].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (latest.signedAt) return "signed"; // signed request whose document row isn't visible yet: still signed
  if (latest.revokedAt) return "revoked";
  return Date.parse(latest.expiresAt) > now.getTime() ? "waiting" : "expired";
}

/**
 * A car is out, or about to go out, with no signed agreement. Returned and closed
 * rentals are history, and approved ones aren't scheduled yet, so they don't count.
 */
export function needsAttention(rentalStatus: string, state: AgreementState): boolean {
  return state !== "signed" && (rentalStatus === "active" || rentalStatus === "scheduled");
}
