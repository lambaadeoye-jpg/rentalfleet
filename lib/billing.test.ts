import { describe, it, expect } from "vitest";
import { interpretChargeResponse } from "./stripe";
import { billingErrorLabel } from "./billing";

describe("interpretChargeResponse", () => {
  it("treats a succeeded intent as paid", () => {
    expect(interpretChargeResponse(true, 200, { id: "pi_1", status: "succeeded" })).toEqual({ ok: true, id: "pi_1" });
  });
  it("leaves a processing intent pending so it is never charged twice", () => {
    expect(interpretChargeResponse(true, 200, { id: "pi_2", status: "processing" })).toEqual({ ok: "pending", id: "pi_2" });
  });
  it("fails an intent that needs the renter to act", () => {
    const r = interpretChargeResponse(true, 200, { id: "pi_3", status: "requires_action" });
    expect(r.ok).toBe(false);
  });
  it("uses the decline code on a card error", () => {
    expect(interpretChargeResponse(false, 402, { error: { code: "card_declined", decline_code: "insufficient_funds" } }))
      .toEqual({ ok: false, error: "stripe_insufficient_funds" });
  });
  it("treats Stripe outages and rate limits as unknown, not failed", () => {
    expect(interpretChargeResponse(false, 503, null).ok).toBe("pending");
    expect(interpretChargeResponse(false, 429, null).ok).toBe("pending");
  });
  it("fails a bad request without a code", () => {
    expect(interpretChargeResponse(false, 400, null)).toEqual({ ok: false, error: "stripe_http_400" });
  });
});

describe("billingErrorLabel", () => {
  it("maps known codes and falls back", () => {
    expect(billingErrorLabel("stripe_insufficient_funds")).toBe("Insufficient funds");
    expect(billingErrorLabel("stripe_weird")).toBe("Charge failed");
    expect(billingErrorLabel(null)).toBe("Charge failed");
  });
});

describe("processBilling for one renter", () => {
  it("passes the renter filter to the database and sends the plain call otherwise", async () => {
    const { processBilling } = await import("./billing");
    const calls: Array<[string, unknown]> = [];
    const db: any = { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: [], error: null }; } };
    const prev = { k: process.env.STRIPE_SECRET_KEY, w: process.env.STRIPE_WEBHOOK_SECRET };
    process.env.STRIPE_SECRET_KEY = "sk_test_x"; process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    try {
      await processBilling(db, { customerId: "c-1" });
      await processBilling(db);
    } finally {
      process.env.STRIPE_SECRET_KEY = prev.k; process.env.STRIPE_WEBHOOK_SECRET = prev.w;
      if (prev.k === undefined) delete process.env.STRIPE_SECRET_KEY;
      if (prev.w === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    }
    expect(calls[0]).toEqual(["claim_due_billing", { p_limit: 10, p_customer: "c-1" }]);
    expect(calls[1]).toEqual(["claim_due_billing", { p_limit: 10 }]);
  });
});
