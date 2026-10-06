import { describe, it, expect } from "vitest";
import {
  DEFAULT_CANCELLATION_RULES as R,
  settlePrePickup,
  refundNeedsAdminApproval,
  validateCancellationRules,
} from "./cancellation-policy";

const base = { priorFreeCancellations90d: 0, rentPaidUsd: 450, depositPaidUsd: 150 };

describe("settlePrePickup", () => {
  it("refunds everything when cancelling well ahead (first cancellation)", () => {
    const s = settlePrePickup({ ...base, reason: "renter_cancelled", hoursUntilPickup: 48 }, R);
    expect(s).toEqual({ feeUsd: 0, feeKind: "none", rentRefundUsd: 450, depositRefundUsd: 150 });
  });
  it("still free on the second cancellation in 90 days, $25 on the third", () => {
    expect(settlePrePickup({ ...base, priorFreeCancellations90d: 1, reason: "renter_cancelled", hoursUntilPickup: 48 }, R).feeUsd).toBe(0);
    const third = settlePrePickup({ ...base, priorFreeCancellations90d: 2, reason: "renter_cancelled", hoursUntilPickup: 48 }, R);
    expect(third.feeUsd).toBe(25);
    expect(third.feeKind).toBe("early");
    expect(third.rentRefundUsd).toBe(425);
  });
  it("charges the late fee inside 24 hours, with exactly 24h counting as late", () => {
    expect(settlePrePickup({ ...base, reason: "renter_cancelled", hoursUntilPickup: 23.9 }, R).feeUsd).toBe(65);
    expect(settlePrePickup({ ...base, reason: "renter_cancelled", hoursUntilPickup: 24 }, R).feeUsd).toBe(65);
    expect(settlePrePickup({ ...base, reason: "renter_cancelled", hoursUntilPickup: 24.1 }, R).feeUsd).toBe(0);
  });
  it("charges the late fee on a no-show and keeps the deposit refundable in full", () => {
    const s = settlePrePickup({ ...base, reason: "no_show", hoursUntilPickup: -3 }, R);
    expect(s).toEqual({ feeUsd: 65, feeKind: "late", rentRefundUsd: 385, depositRefundUsd: 150 });
  });
  it("charges the late fee once when a stated requirement fails at pickup", () => {
    expect(settlePrePickup({ ...base, reason: "requirement_failed", hoursUntilPickup: 0 }, R).feeUsd).toBe(65);
  });
  it("never charges when Zivo cancels or fraud is found", () => {
    expect(settlePrePickup({ ...base, reason: "zivo_cancelled", hoursUntilPickup: 1 }, R).feeUsd).toBe(0);
    expect(settlePrePickup({ ...base, reason: "fraud_or_identity", hoursUntilPickup: 1 }, R).feeUsd).toBe(0);
  });
  it("caps the fee at the rent paid and never touches the deposit", () => {
    const s = settlePrePickup({ ...base, rentPaidUsd: 40, reason: "no_show", hoursUntilPickup: 0 }, R);
    expect(s.feeUsd).toBe(40);
    expect(s.rentRefundUsd).toBe(0);
    expect(s.depositRefundUsd).toBe(150);
  });
  it("charges nothing when no rent was paid yet", () => {
    const s = settlePrePickup({ ...base, rentPaidUsd: 0, reason: "no_show", hoursUntilPickup: 0 }, R);
    expect(s).toEqual({ feeUsd: 0, feeKind: "none", rentRefundUsd: 0, depositRefundUsd: 150 });
  });
});

describe("refundNeedsAdminApproval", () => {
  it("requires approval only above the limit", () => {
    expect(refundNeedsAdminApproval(200, R)).toBe(false);
    expect(refundNeedsAdminApproval(200.01, R)).toBe(true);
  });
});

describe("validateCancellationRules", () => {
  it("accepts the defaults, approved", () => {
    expect(validateCancellationRules({ ...R, approved: true }).ok).toBe(true);
  });
  it("rejects out-of-range or fractional values", () => {
    expect(validateCancellationRules({ ...R, late_fee_usd: 500 }).ok).toBe(false);
    expect(validateCancellationRules({ ...R, late_fee_usd: -1 }).ok).toBe(false);
    expect(validateCancellationRules({ ...R, late_window_hours: 0 }).ok).toBe(false);
    expect(validateCancellationRules({ ...R, late_window_hours: 24.5 }).ok).toBe(false);
    expect(validateCancellationRules({ ...R, toll_ticket_window_days: 3 }).ok).toBe(false);
    expect(validateCancellationRules({ ...R, free_cancellations_per_90d: -1 }).ok).toBe(false);
  });
  it("refuses approval without both fees", () => {
    expect(validateCancellationRules({ ...R, early_fee_usd: null, approved: true }).ok).toBe(false);
    expect(validateCancellationRules({ ...R, early_fee_usd: null, approved: false }).ok).toBe(true);
  });
});
