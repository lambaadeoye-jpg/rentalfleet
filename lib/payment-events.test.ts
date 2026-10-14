import { describe, expect, it } from "vitest";
import { describePaymentAlert, parsePaymentAlert } from "./payment-events";

const dispute = (type: string, o: object = {}) => ({ id: "evt_1", type, data: { object: { id: "dp_1", payment_intent: "pi_1", charge: "ch_1", amount: 45000, reason: "fraudulent", status: "needs_response", ...o } } });

describe("parsePaymentAlert", () => {
  it("opened dispute", () => {
    expect(parsePaymentAlert(dispute("charge.dispute.created"))).toEqual({
      eventId: "evt_1", kind: "dispute_opened", paymentIntentId: "pi_1", chargeId: "ch_1", amountCents: 45000, reason: "fraudulent", status: "needs_response",
    });
  });
  it("closed dispute carries the outcome", () => {
    const a = parsePaymentAlert(dispute("charge.dispute.closed", { status: "lost" }));
    expect(a?.kind).toBe("dispute_closed");
    expect(describePaymentAlert(a!)).toContain("lost");
  });
  it("failed refund from either event, but not a refund that merely changed", () => {
    expect(parsePaymentAlert({ id: "e", type: "refund.failed", data: { object: { payment_intent: "pi_1", amount: 1000, failure_reason: "unknown", status: "failed" } } })?.kind).toBe("refund_failed");
    expect(parsePaymentAlert({ id: "e", type: "charge.refund.updated", data: { object: { payment_intent: "pi_1", status: "failed" } } })?.kind).toBe("refund_failed");
    expect(parsePaymentAlert({ id: "e", type: "charge.refund.updated", data: { object: { payment_intent: "pi_1", status: "succeeded" } } })).toBeNull();
  });
  it("ignores everything else and junk", () => {
    expect(parsePaymentAlert({ id: "e", type: "checkout.session.completed", data: { object: {} } })).toBeNull();
    expect(parsePaymentAlert(null)).toBeNull();
    expect(parsePaymentAlert({ id: 1, type: "charge.dispute.created" })).toBeNull();
    expect(parsePaymentAlert({ id: "e", type: "charge.dispute.created" })).toBeNull();
  });
  it("alert text tells staff what to do and holds no personal data", () => {
    const text = describePaymentAlert(parsePaymentAlert(dispute("charge.dispute.created"))!);
    expect(text).toMatch(/respond in Stripe/i);
    expect(text).toContain("$450.00");
    expect(text).not.toMatch(/pi_|ch_/);
  });
});
