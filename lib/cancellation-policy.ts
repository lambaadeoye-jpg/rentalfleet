// Cancellation and refund rules. Pure functions only -- the amounts live in
// policy_version.rules.cancellation (admin-set on /staff/pricing) and each
// rental keeps a snapshot of them, like every other price.
//
// Policy summary (approved by the owner, Oct 2026):
//  - Cancel more than late_window_hours before pickup: full refund; the first
//    free_cancellations_per_90d cancellations in any 90 days cost nothing,
//    later ones cost early_fee_usd.
//  - Cancel inside the window, or no-show: late_fee_usd comes off the rent.
//  - Zivo's error / no car ready / fraud found: full refund, no fee.
//  - Renter can't meet a stated requirement at pickup: late_fee_usd once.
//  - The refundable deposit always comes back in full before pickup.
// no_refund (rental agreement clause 14, Oct 2026): once a car is reserved, rent
// is not refunded when the renter cancels, no-shows or fails a requirement at
// pickup. Zivo's error and fraud found before pickup still refund in full, and
// the deposit still comes back in full before pickup.
// After pickup a started week is never prorated (7-day minimum); that is a
// rental-time rule, not handled here.

export type CancellationRules = {
  late_fee_usd: number | null;
  early_fee_usd: number | null;
  free_cancellations_per_90d: number;
  late_window_hours: number;
  noshow_grace_hours: number;
  rebook_days: number;
  toll_ticket_window_days: number;
  admin_approval_threshold_usd: number;
  no_refund: boolean; // rent is kept when the renter cancels or no-shows (fees below then do not apply)
  approved: boolean;
};

export const DEFAULT_CANCELLATION_RULES: CancellationRules = {
  late_fee_usd: 65,
  early_fee_usd: 25,
  free_cancellations_per_90d: 2,
  late_window_hours: 24,
  noshow_grace_hours: 2,
  rebook_days: 7,
  toll_ticket_window_days: 60,
  admin_approval_threshold_usd: 200,
  no_refund: true,
  approved: false,
};

export const CANCELLATION_LIMITS = {
  maxFeeUsd: 150,
  maxFreeCancellations: 10,
  maxLateWindowHours: 72,
  maxGraceHours: 24,
  maxRebookDays: 30,
  minTollWindowDays: 7,
  maxTollWindowDays: 120,
  maxApprovalThresholdUsd: 2000,
} as const;

export function validateCancellationRules(r: CancellationRules): { ok: true } | { ok: false; error: string } {
  const L = CANCELLATION_LIMITS;
  const isInt = (n: unknown) => typeof n === "number" && Number.isInteger(n);
  const feeOk = (n: number | null) => n == null || (typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= L.maxFeeUsd);

  if (!feeOk(r.late_fee_usd) || !feeOk(r.early_fee_usd)) {
    return { ok: false, error: `Cancellation fees must be between $0 and $${L.maxFeeUsd}.` };
  }
  if (!isInt(r.free_cancellations_per_90d) || r.free_cancellations_per_90d < 0 || r.free_cancellations_per_90d > L.maxFreeCancellations) {
    return { ok: false, error: `Free cancellations must be a whole number from 0 to ${L.maxFreeCancellations}.` };
  }
  if (!isInt(r.late_window_hours) || r.late_window_hours < 1 || r.late_window_hours > L.maxLateWindowHours) {
    return { ok: false, error: `The late-cancellation window must be 1 to ${L.maxLateWindowHours} whole hours.` };
  }
  if (!isInt(r.noshow_grace_hours) || r.noshow_grace_hours < 0 || r.noshow_grace_hours > L.maxGraceHours) {
    return { ok: false, error: `The no-show grace period must be 0 to ${L.maxGraceHours} whole hours.` };
  }
  if (!isInt(r.rebook_days) || r.rebook_days < 1 || r.rebook_days > L.maxRebookDays) {
    return { ok: false, error: `The rebooking window must be 1 to ${L.maxRebookDays} whole days.` };
  }
  if (!isInt(r.toll_ticket_window_days) || r.toll_ticket_window_days < L.minTollWindowDays || r.toll_ticket_window_days > L.maxTollWindowDays) {
    return { ok: false, error: `The toll and ticket window must be ${L.minTollWindowDays} to ${L.maxTollWindowDays} whole days.` };
  }
  if (typeof r.admin_approval_threshold_usd !== "number" || !(r.admin_approval_threshold_usd >= 0) || r.admin_approval_threshold_usd > L.maxApprovalThresholdUsd) {
    return { ok: false, error: `The refund approval limit must be between $0 and $${L.maxApprovalThresholdUsd}.` };
  }
  if (r.approved && !r.no_refund && (r.late_fee_usd == null || r.early_fee_usd == null)) {
    return { ok: false, error: "Set both cancellation fees before approving the cancellation policy." };
  }
  return { ok: true };
}

export type PrePickupReason =
  | "renter_cancelled"
  | "no_show"
  | "requirement_failed" // card not in own name, no valid license, no verified insurance
  | "zivo_cancelled" // Zivo's error or no car ready
  | "fraud_or_identity"; // found before pickup

export type PrePickupSettlement = {
  feeUsd: number;
  feeKind: "none" | "early" | "late";
  rentRefundUsd: number;
  depositRefundUsd: number;
};

const cents = (n: number) => Math.round(n * 100) / 100;

// What happens to money paid before the car leaves. The fee comes out of the
// rent only (never the deposit, which is always refunded in full) and can
// never exceed the rent actually paid.
export function settlePrePickup(
  input: { reason: PrePickupReason; hoursUntilPickup: number; priorFreeCancellations90d: number; rentPaidUsd: number; depositPaidUsd: number },
  rules: CancellationRules
): PrePickupSettlement {
  let feeKind: PrePickupSettlement["feeKind"] = "none";
  let fee = 0;

  switch (input.reason) {
    case "zivo_cancelled":
    case "fraud_or_identity":
      break;
    case "no_show":
    case "requirement_failed":
      feeKind = "late";
      fee = rules.late_fee_usd ?? 0;
      break;
    case "renter_cancelled":
      if (input.hoursUntilPickup > rules.late_window_hours) {
        if (input.priorFreeCancellations90d >= rules.free_cancellations_per_90d) {
          feeKind = "early";
          fee = rules.early_fee_usd ?? 0;
        }
      } else {
        feeKind = "late";
        fee = rules.late_fee_usd ?? 0;
      }
      break;
  }

  const rent = Math.max(0, input.rentPaidUsd);
  if (rules.no_refund && (input.reason === "renter_cancelled" || input.reason === "no_show" || input.reason === "requirement_failed")) {
    feeKind = "late";
    fee = rent;
  }
  fee = cents(Math.min(fee, rent));
  if (fee === 0) feeKind = "none";
  return {
    feeUsd: fee,
    feeKind,
    rentRefundUsd: cents(rent - fee),
    depositRefundUsd: cents(Math.max(0, input.depositPaidUsd)),
  };
}

// Refunds above the limit need a second, admin approval.
export function refundNeedsAdminApproval(totalRefundUsd: number, rules: CancellationRules): boolean {
  return totalRefundUsd > rules.admin_approval_threshold_usd;
}
