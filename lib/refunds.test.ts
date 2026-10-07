import { describe, it, expect } from "vitest";
import { allocateRefund, settlementSummary, cancelErrorMessage, parseSettlement } from "./refunds";
import { settlePrePickup, DEFAULT_CANCELLATION_RULES } from "./cancellation-policy";

describe("allocateRefund", () => {
  it("one payment covers it", () => expect(allocateRefund([{ pi: "pi_1", paid_cents: 50000 }], 43500)).toEqual([{ pi: "pi_1", cents: 43500 }]));
  it("splits across payments in a stable order", () => {
    expect(allocateRefund([{ pi: "pi_b", paid_cents: 10000 }, { pi: "pi_a", paid_cents: 30000 }], 35000)).toEqual([{ pi: "pi_a", cents: 30000 }, { pi: "pi_b", cents: 5000 }]);
  });
  it("refuses to refund more than the card paid", () => expect(allocateRefund([{ pi: "pi_1", paid_cents: 1000 }], 1001)).toBeNull());
  it("zero is nothing to send", () => expect(allocateRefund([], 0)).toEqual([]));
  it("rejects bad amounts", () => { expect(allocateRefund([{ pi: "pi_1", paid_cents: 100 }], -1)).toBeNull(); expect(allocateRefund([{ pi: "pi_1", paid_cents: 100 }], 1.5)).toBeNull(); });
  it("never allocates more than requested in total", () => {
    const parts = allocateRefund([{ pi: "pi_a", paid_cents: 500 }, { pi: "pi_b", paid_cents: 500 }, { pi: "pi_c", paid_cents: 500 }], 900)!;
    expect(parts.reduce((s, p) => s + p.cents, 0)).toBe(900);
  });
});

describe("settlement wording", () => {
  const base = { feeCents: 0, feeKind: "none" as const, rentRefundCents: 30000, depositRefundCents: 20000, totalRefundCents: 50000, manualCents: 0, status: "pending_approval", needsAdmin: true, vehicleReleased: true, refundId: null };
  it("full refund", () => expect(settlementSummary(base)).toBe("No fee applies. $500.00 goes back to the original card, including the $200.00 deposit in full."));
  it("late fee", () => expect(settlementSummary({ ...base, feeCents: 6500, feeKind: "late", rentRefundCents: 23500, totalRefundCents: 43500 })).toContain("$65.00 late-cancellation fee"));
  it("early fee", () => expect(settlementSummary({ ...base, feeCents: 2500, feeKind: "early", totalRefundCents: 47500 })).toContain("$25.00 cancellation fee"));
  it("nothing paid", () => expect(settlementSummary({ ...base, rentRefundCents: 0, depositRefundCents: 0, totalRefundCents: 0 })).toMatch(/nothing to refund/));
  it("parses a database row", () => expect(parseSettlement({ fee_cents: 1, fee_kind: "late", rent_refund_cents: 2, deposit_refund_cents: 3, total_refund_cents: 5, manual_cents: 0, status: "approved", needs_admin: false, vehicle_released: true, refund_id: "x" })?.refundId).toBe("x"));
  it("friendly errors", () => { expect(cancelErrorMessage("not_cancellable")).toMatch(/can't be cancelled/); expect(cancelErrorMessage("boom")).toMatch(/Couldn't cancel/); });
});

// The database function _settle_pre_pickup must agree with the TypeScript rules. These are the same
// cases the scratch-database test ran against it ($300 rent + $200 deposit, default fees).
describe("rules agree with the database cases", () => {
  const R = { ...DEFAULT_CANCELLATION_RULES, approved: true };
  const run = (reason: any, hours: number, prior = 0) => settlePrePickup({ reason, hoursUntilPickup: hours, priorFreeCancellations90d: prior, rentPaidUsd: 300, depositPaidUsd: 200 }, R);
  it("first cancel 3 days out: full $500", () => { const s = run("renter_cancelled", 72); expect([s.feeUsd, s.rentRefundUsd + s.depositRefundUsd]).toEqual([0, 500]); });
  it("3rd cancel in 90 days: $25 early fee, $475", () => { const s = run("renter_cancelled", 72, 2); expect([s.feeUsd, s.rentRefundUsd + s.depositRefundUsd]).toEqual([25, 475]); });
  it("6 hours out: $65 late fee, $435", () => { const s = run("renter_cancelled", 6); expect([s.feeUsd, s.rentRefundUsd + s.depositRefundUsd]).toEqual([65, 435]); });
  it("exactly at the window counts as late", () => expect(run("renter_cancelled", 24).feeUsd).toBe(65));
  it("no-show / failed requirement: $65, $435", () => { expect(run("no_show", 0).feeUsd).toBe(65); expect(run("requirement_failed", 0).feeUsd).toBe(65); });
  it("Zivo / fraud: no fee, $500", () => { expect(run("zivo_cancelled", 1).feeUsd).toBe(0); expect(run("fraud_or_identity", 1).feeUsd).toBe(0); });
});

import { parseDepositReturn, depositReturnSummary, settleErrorMessage } from "./refunds";
describe("deposit return", () => {
  it("summarises the amount and deductions", () => {
    const d = parseDepositReturn({ refund_id: null, deposit_refund_cents: 35000, deductions_cents: 10000, manual_cents: 0, status: "pending_approval", needs_admin: true })!;
    expect(depositReturnSummary(d)).toContain("$350.00");
    expect(depositReturnSummary(d)).toContain("$100.00 of approved deductions");
    expect(depositReturnSummary(d)).toContain("Weekly rent already paid is not refunded");
  });
  it("says so when nothing is left", () => {
    const d = parseDepositReturn({ deposit_refund_cents: 0, deductions_cents: 45000, manual_cents: 0, status: "no_refund_due", needs_admin: false })!;
    expect(depositReturnSummary(d)).toContain("no deposit left");
  });
  it("maps database errors to plain words", () => {
    expect(settleErrorMessage("pending_charges")).toContain("Charges page");
    expect(settleErrorMessage("not_returned")).toContain("dropoff");
    expect(settleErrorMessage("weird")).toBe("Couldn't settle the deposit. Please try again.");
  });
});
