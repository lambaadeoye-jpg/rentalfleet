import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { computeCheckoutAmounts, refundTermsLines, buildCheckoutBody, verifyStripeSignature, parseCheckoutEvent } from "./checkout";

const base = { weeklyRateUsd: 185, quotedTotalUsd: null, depositRequiredUsd: 250, depositCollectedUsd: 0, rentPaidUsd: 0 };

describe("computeCheckoutAmounts", () => {
  it("first week plus deposit in cents", () => {
    expect(computeCheckoutAmounts(base)).toEqual({ ok: true, rentCents: 18500, depositCents: 25000, totalCents: 43500 });
  });
  it("subtracts what is already paid, never negative", () => {
    expect(computeCheckoutAmounts({ ...base, rentPaidUsd: 185 })).toEqual({ ok: true, rentCents: 0, depositCents: 25000, totalCents: 25000 });
    expect(computeCheckoutAmounts({ ...base, rentPaidUsd: 500, depositCollectedUsd: 100 })).toEqual({ ok: true, rentCents: 0, depositCents: 15000, totalCents: 15000 });
  });
  it("daily plan uses the quoted total", () => {
    expect(computeCheckoutAmounts({ ...base, weeklyRateUsd: null, quotedTotalUsd: 310.5 })).toMatchObject({ rentCents: 31050 });
  });
  it("floating point money is rounded to whole cents", () => {
    expect(computeCheckoutAmounts({ ...base, weeklyRateUsd: 0.1 + 0.2, depositRequiredUsd: 0 })).toEqual({ ok: false, error: "below_minimum" });
    expect(computeCheckoutAmounts({ ...base, weeklyRateUsd: 19.99, depositRequiredUsd: 0 })).toMatchObject({ rentCents: 1999 });
  });
  it("guards", () => {
    expect(computeCheckoutAmounts({ ...base, weeklyRateUsd: null })).toEqual({ ok: false, error: "rent_not_set" });
    expect(computeCheckoutAmounts({ ...base, depositRequiredUsd: null })).toEqual({ ok: false, error: "deposit_not_set" });
    expect(computeCheckoutAmounts({ ...base, rentPaidUsd: 185, depositCollectedUsd: 250 })).toEqual({ ok: false, error: "nothing_due" });
  });
});

describe("refundTermsLines", () => {
  const rules = { approved: true, late_fee_usd: 65, early_fee_usd: 25, free_cancellations_per_90d: 2, late_window_hours: 24, noshow_grace_hours: 2, rebook_days: 7 };
  it("writes the approved numbers", () => {
    const lines = refundTermsLines(rules)!;
    expect(lines.join(" ")).toContain("$65");
    expect(lines.join(" ")).toContain("$25");
    expect(lines.join(" ")).toContain("24 hours");
    expect(lines.join(" ")).toContain("2 free cancellations");
    expect(lines.join(" ")).toContain("original card only");
  });
  it("null until approved and complete", () => {
    expect(refundTermsLines(null)).toBeNull();
    expect(refundTermsLines({ ...rules, approved: false })).toBeNull();
    expect(refundTermsLines({ ...rules, late_fee_usd: null })).toBeNull();
  });
});

describe("buildCheckoutBody", () => {
  const p = { payRequestId: "pr_1", rentalId: "r_1", rentCents: 18500, depositCents: 25000, customerEmail: "a@x.com", successUrl: "https://x/ok", cancelUrl: "https://x/no", nowSeconds: 1_000_000 };
  it("card only, saves card, two line items, expiry", () => {
    const b = buildCheckoutBody(p);
    expect(b.get("mode")).toBe("payment");
    expect(b.get("payment_method_types[0]")).toBe("card");
    expect(b.get("payment_method_types[1]")).toBeNull();
    expect(b.get("payment_intent_data[setup_future_usage]")).toBe("off_session");
    expect(b.get("line_items[0][price_data][unit_amount]")).toBe("18500");
    expect(b.get("line_items[1][price_data][unit_amount]")).toBe("25000");
    expect(b.get("line_items[1][price_data][product_data][name]")).toBe("Refundable deposit");
    expect(b.get("client_reference_id")).toBe("pr_1");
    expect(b.get("expires_at")).toBe(String(1_000_000 + 3600));
  });
  it("skips a zero line", () => {
    const b = buildCheckoutBody({ ...p, rentCents: 0 });
    expect(b.get("line_items[0][price_data][unit_amount]")).toBe("25000");
    expect(b.get("line_items[1][price_data][unit_amount]")).toBeNull();
  });
});

describe("verifyStripeSignature", () => {
  const secret = "whsec_test";
  const payload = '{"id":"evt_1"}';
  const sign = (t: number, body = payload, key = secret) => createHmac("sha256", key).update(`${t}.${body}`).digest("hex");
  it("accepts a valid recent signature", () => expect(verifyStripeSignature(payload, `t=1000,v1=${sign(1000)}`, secret, 1100)).toBe(true));
  it("accepts when one of several v1 matches", () => expect(verifyStripeSignature(payload, `t=1000,v1=${"0".repeat(64)},v1=${sign(1000)}`, secret, 1000)).toBe(true));
  it("rejects tampered body, wrong secret, stale, malformed, missing", () => {
    expect(verifyStripeSignature(payload + " ", `t=1000,v1=${sign(1000)}`, secret, 1000)).toBe(false);
    expect(verifyStripeSignature(payload, `t=1000,v1=${sign(1000, payload, "other")}`, secret, 1000)).toBe(false);
    expect(verifyStripeSignature(payload, `t=1000,v1=${sign(1000)}`, secret, 1000 + 301)).toBe(false);
    expect(verifyStripeSignature(payload, `t=abc,v1=${sign(1000)}`, secret, 1000)).toBe(false);
    expect(verifyStripeSignature(payload, "v1=zzz", secret, 1000)).toBe(false);
    expect(verifyStripeSignature(payload, null, secret, 1000)).toBe(false);
    expect(verifyStripeSignature(payload, `t=1000,v1=${sign(1000)}`, "", 1000)).toBe(false);
  });
});

describe("parseCheckoutEvent", () => {
  const ev = (over: any = {}) => ({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", client_reference_id: "pr_1", payment_intent: "pi_1", customer: "cus_1", amount_total: 43500, payment_status: "paid", ...over } } });
  it("extracts fields", () => expect(parseCheckoutEvent(ev())).toEqual({ eventId: "evt_1", type: "checkout.session.completed", sessionId: "cs_1", payRequestId: "pr_1", paymentIntentId: "pi_1", stripeCustomerId: "cus_1", amountTotalCents: 43500, paid: true }));
  it("unpaid completed session is not paid", () => expect(parseCheckoutEvent(ev({ payment_status: "unpaid" }))!.paid).toBe(false));
  it("ignores other event types and junk", () => {
    expect(parseCheckoutEvent({ id: "e", type: "charge.refunded", data: { object: { id: "x" } } })).toBeNull();
    expect(parseCheckoutEvent(null)).toBeNull();
    expect(parseCheckoutEvent({ id: 1 })).toBeNull();
  });
});

import { extractCardInfo } from "./stripe";
describe("extractCardInfo", () => {
  it("reads card details and billing name", () => {
    const pi = { payment_method: "pm_1", latest_charge: { billing_details: { name: "ANN BAKER" }, payment_method_details: { card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } } } };
    expect(extractCardInfo(pi)).toEqual({ paymentMethodId: "pm_1", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030, billingName: "ANN BAKER" });
  });
  it("tolerates missing or unexpanded data", () => {
    expect(extractCardInfo({ payment_method: "pm_1", latest_charge: "ch_1" })).toEqual({ paymentMethodId: "pm_1", brand: null, last4: null, expMonth: null, expYear: null, billingName: null });
    expect(extractCardInfo(null).paymentMethodId).toBeNull();
  });
});
