import { describe, expect, it } from "vitest";
import {
  CASH_APP_BRAND, escapeLike, extractSavedMethod, isCashAppBrand, methodLabel, methodTypeForBrand, payButtonLabel, payNote, paymentMethodTypes,
} from "./payment-methods";
import { buildCheckoutBody, refundTermsLines } from "./checkout";
import { buildSetupSessionBody, cardAuthorizationText, extractSetupCard } from "./card-update";
import { buildChargeBody, extractCardInfo } from "./stripe";
import { CASH_APP_IS_LIVE } from "./site-config";

const checkout = { payRequestId: "pr", rentalId: "r", rentCents: 45000, depositCents: 10000, customerEmail: null, successUrl: "https://x/s", cancelUrl: "https://x/c", nowSeconds: 1000 };
const setup = { requestId: "q", stripeCustomerId: null, email: null, successUrl: "https://x/s", cancelUrl: "https://x/c", nowSeconds: 1000, includeEmail: false };
const rules = { approved: true, no_refund: true };

describe("Cash App launch switch", () => {
  it("ships off until it is deliberately turned on", () => {
    expect(CASH_APP_IS_LIVE).toBe(false);
    expect(paymentMethodTypes()).toEqual(["card"]);
  });
});

describe("paymentMethodTypes", () => {
  it("offers card first, Cash App only when on", () => {
    expect(paymentMethodTypes(false)).toEqual(["card"]);
    expect(paymentMethodTypes(true)).toEqual(["card", "cashapp"]);
  });
});

describe("Stripe request bodies", () => {
  it("checkout: card by default, both when asked, always saved for later", () => {
    const card = buildCheckoutBody(checkout);
    expect(card.get("payment_method_types[0]")).toBe("card");
    expect(card.get("payment_method_types[1]")).toBeNull();
    const both = buildCheckoutBody({ ...checkout, methodTypes: ["card", "cashapp"] });
    expect(both.get("payment_method_types[0]")).toBe("card");
    expect(both.get("payment_method_types[1]")).toBe("cashapp");
    expect(both.get("payment_intent_data[setup_future_usage]")).toBe("off_session");
  });
  it("update-method link: card by default, both when asked", () => {
    expect(buildSetupSessionBody(setup).get("payment_method_types[1]")).toBeNull();
    const both = buildSetupSessionBody({ ...setup, methodTypes: ["card", "cashapp"] });
    expect(both.get("payment_method_types[0]")).toBe("card");
    expect(both.get("payment_method_types[1]")).toBe("cashapp");
    expect(both.get("mode")).toBe("setup");
  });
  it("weekly charge uses the type that matches the saved method", () => {
    const card = buildChargeBody("cus_1", "pm_1", 45000, "att", "rent", "card");
    const cash = buildChargeBody("cus_1", "pm_2", 45000, "att", "rent", "cashapp");
    expect(card.get("payment_method_types[]")).toBe("card");
    expect(cash.get("payment_method_types[]")).toBe("cashapp");
    for (const b of [card, cash]) {
      expect(b.get("off_session")).toBe("true");
      expect(b.get("confirm")).toBe("true");
      expect(b.get("amount")).toBe("45000");
    }
  });
});

describe("saved method details", () => {
  it("a Cash App payment is stored as Cash App with no card digits or expiry", () => {
    const info = extractCardInfo({ payment_method: "pm_9", latest_charge: { billing_details: { name: "Sam Lee" }, payment_method_details: { type: "cashapp", cashapp: { cashtag: "$sam" } } } });
    expect(info).toEqual({ paymentMethodId: "pm_9", brand: CASH_APP_BRAND, last4: null, expMonth: null, expYear: null, billingName: "Sam Lee" });
  });
  it("a card payment is read as before", () => {
    const info = extractCardInfo({ payment_method: "pm_1", latest_charge: { billing_details: { name: "Sam Lee" }, payment_method_details: { type: "card", card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030 } } } });
    expect(info).toMatchObject({ brand: "visa", last4: "4242", expMonth: 4, expYear: 2030, billingName: "Sam Lee" });
  });
  it("a saved Cash App account from an update-method link", () => {
    const c = extractSetupCard({ customer: "cus_1", payment_method: { id: "pm_5", type: "cashapp", billing_details: { name: "Pat" }, cashapp: {} } });
    expect(c).toMatchObject({ paymentMethodId: "pm_5", stripeCustomerId: "cus_1", brand: CASH_APP_BRAND, last4: null, billingName: "Pat" });
  });
  it("extractSavedMethod tolerates missing data", () => {
    expect(extractSavedMethod(undefined)).toEqual({ brand: null, last4: null, expMonth: null, expYear: null, billingName: null });
  });
  it("maps brand to the Stripe type and a label", () => {
    expect(isCashAppBrand("cash_app")).toBe(true);
    expect(isCashAppBrand("visa")).toBe(false);
    expect(methodTypeForBrand("cash_app")).toBe("cashapp");
    expect(methodTypeForBrand("visa")).toBe("card");
    expect(methodTypeForBrand(null)).toBe("card");
    expect(methodLabel("cash_app", null)).toBe("Cash App");
    expect(methodLabel("visa", "4242")).toBe("Card ending 4242");
    expect(methodLabel(null, null)).toBe("Card");
  });
});

describe("wording follows the switch", () => {
  it("pay page", () => {
    expect(payButtonLabel("$550.00", false)).toBe("Pay $550.00 by card");
    expect(payButtonLabel("$550.00", true)).toBe("Pay $550.00");
    expect(payNote(true)).toMatch(/Cash App/);
    expect(payNote(false)).not.toMatch(/Cash App/);
  });
  it("update-method consent", () => {
    expect(cardAuthorizationText(false)).not.toMatch(/Cash App/);
    expect(cardAuthorizationText(true)).toMatch(/Cash App/);
    expect(cardAuthorizationText(true)).not.toMatch(/within \d+|guarantee/i);
  });
  it("refund terms: card wording unchanged when off, Cash App wording when on", () => {
    const off = refundTermsLines(rules, false)!.join(" ");
    expect(off).toContain("original card only");
    expect(off).not.toMatch(/Cash App/);
    const on = refundTermsLines(rules, true)!.join(" ");
    expect(on).toMatch(/original card or Cash App account only/);
    expect(on).toMatch(/Cash App account in your own name/);
    expect(on).not.toMatch(/\b\d+ (business )?days\b/);
  });
});

describe("escapeLike", () => {
  it("makes Stripe ids literal in a LIKE pattern", () => {
    expect(escapeLike("pi_3Abc")).toBe("pi\\_3Abc");
    expect(escapeLike("a%b\\c")).toBe("a\\%b\\\\c");
  });
});
