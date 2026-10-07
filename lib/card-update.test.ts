import { describe, it, expect } from "vitest";
import { buildSetupSessionBody, parseSetupEvent, extractSetupCard, cardUpdateUrl, CARD_AUTHORIZATION_TEXT } from "./card-update";

const base = {
  requestId: "11111111-1111-1111-1111-111111111111",
  stripeCustomerId: null as string | null,
  email: "a@x.com" as string | null,
  successUrl: "https://rentzivo.com/card/T?status=success",
  cancelUrl: "https://rentzivo.com/card/T?status=cancelled",
  nowSeconds: 1_700_000_000,
  includeEmail: true,
};

describe("buildSetupSessionBody", () => {
  it("is setup mode, card only, and charges nothing", () => {
    const b = buildSetupSessionBody(base);
    expect(b.get("mode")).toBe("setup");
    expect(b.get("payment_method_types[0]")).toBe("card");
    expect([...b.keys()].some((k) => k.startsWith("line_items"))).toBe(false);
    expect(b.get("client_reference_id")).toBe(base.requestId);
    expect(b.get("setup_intent_data[metadata][card_update_request_id]")).toBe(base.requestId);
    expect(b.get("expires_at")).toBe(String(1_700_000_000 + 3600));
  });
  it("reuses the renter's Stripe customer and then does not send an email", () => {
    const b = buildSetupSessionBody({ ...base, stripeCustomerId: "cus_ABC123" });
    expect(b.get("customer")).toBe("cus_ABC123");
    expect(b.get("customer_email")).toBeNull();
  });
  it("ignores a malformed customer id", () => {
    const b = buildSetupSessionBody({ ...base, stripeCustomerId: "evil&mode=payment" });
    expect(b.get("customer")).toBeNull();
    expect(b.get("mode")).toBe("setup");
    expect(b.get("customer_email")).toBe("a@x.com");
  });
  it("can leave the email out", () => {
    expect(buildSetupSessionBody({ ...base, includeEmail: false }).get("customer_email")).toBeNull();
    expect(buildSetupSessionBody({ ...base, email: null }).get("customer_email")).toBeNull();
  });
});

describe("parseSetupEvent", () => {
  const ev = (over: any = {}, obj: any = {}) => ({
    id: "evt_1", type: "checkout.session.completed",
    data: { object: { id: "cs_1", mode: "setup", client_reference_id: "req-1", setup_intent: "seti_1", customer: "cus_1", ...obj } },
    ...over,
  });
  it("reads a finished setup session", () => {
    expect(parseSetupEvent(ev())).toEqual({ eventId: "evt_1", sessionId: "cs_1", requestId: "req-1", setupIntentId: "seti_1", stripeCustomerId: "cus_1" });
  });
  it("falls back to metadata for the request id", () => {
    const r = parseSetupEvent(ev({}, { client_reference_id: null, metadata: { card_update_request_id: "req-2" } }));
    expect(r?.requestId).toBe("req-2");
  });
  it("ignores payment-mode sessions and other event types", () => {
    expect(parseSetupEvent(ev({}, { mode: "payment" }))).toBeNull();
    expect(parseSetupEvent(ev({ type: "checkout.session.expired" }))).toBeNull();
    expect(parseSetupEvent(null)).toBeNull();
    expect(parseSetupEvent({ id: 5 })).toBeNull();
  });
});

describe("extractSetupCard", () => {
  it("reads the card from an expanded setup intent", () => {
    const c = extractSetupCard({
      customer: "cus_1",
      payment_method: { id: "pm_1", billing_details: { name: "Ann Lee" }, card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } },
    });
    expect(c).toEqual({ paymentMethodId: "pm_1", stripeCustomerId: "cus_1", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030, billingName: "Ann Lee" });
  });
  it("copes with an unexpanded payment method and missing pieces", () => {
    const c = extractSetupCard({ payment_method: "pm_2" });
    expect(c.paymentMethodId).toBe("pm_2");
    expect(c.last4).toBeNull();
    expect(extractSetupCard(null).paymentMethodId).toBeNull();
  });
});

describe("links and wording", () => {
  it("builds the link on the site address", () => {
    expect(cardUpdateUrl("TOKEN", "https://rentzivo.com/")).toBe("https://rentzivo.com/card/TOKEN");
  });
  it("authorization says nothing is charged today and makes no timing promise", () => {
    expect(CARD_AUTHORIZATION_TEXT).toContain("not charged today");
    expect(CARD_AUTHORIZATION_TEXT).not.toMatch(/within \d+|guarantee/i);
  });
});
