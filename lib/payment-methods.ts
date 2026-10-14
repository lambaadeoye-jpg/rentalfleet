// Which payment methods a renter can use, and how a saved method is labelled. Pure, so the rules are unit-tested.
//
// Cards are always on. Cash App Pay (through Stripe) is on only when CASH_APP_IS_LIVE is true in lib/site-config.ts.
// Do not turn it on until: Cash App Pay is enabled in the Stripe dashboard, counsel has amended the agreement's
// payment clause and the refund terms, and one real test payment and one test refund have been done.

import { CASH_APP_IS_LIVE } from "./site-config";

export type MethodType = "card" | "cashapp";

/** Stripe payment_method_types to offer. Card first; Cash App only when it is live. */
export function paymentMethodTypes(cashApp: boolean = CASH_APP_IS_LIVE): MethodType[] {
  return cashApp ? ["card", "cashapp"] : ["card"];
}

/** What we store in customer_payment_method.brand for a saved Cash App account. */
export const CASH_APP_BRAND = "cash_app";
/** What we store in payment.method_type for money received through Cash App. */
export const CASH_APP_PAYMENT_METHOD = "cash_app";

export function isCashAppBrand(brand: string | null | undefined): boolean {
  return brand === CASH_APP_BRAND;
}

/** The Stripe method type to use when charging a saved method, from the brand we stored. */
export function methodTypeForBrand(brand: string | null | undefined): MethodType {
  return isCashAppBrand(brand) ? "cashapp" : "card";
}

/** Short renter/staff-facing label for a saved method. */
export function methodLabel(brand: string | null | undefined, last4: string | null | undefined): string {
  if (isCashAppBrand(brand)) return "Cash App";
  return last4 ? `Card ending ${last4}` : "Card";
}

/** Payment-page wording that depends on whether Cash App is on. */
export function payButtonLabel(totalLabel: string, cashApp: boolean = CASH_APP_IS_LIVE): string {
  return cashApp ? `Pay ${totalLabel}` : `Pay ${totalLabel} by card`;
}

export function payNote(cashApp: boolean = CASH_APP_IS_LIVE): string {
  return cashApp
    ? "Payments are processed by Stripe. Your card or Cash App account is saved for your weekly rent charges. Zivo never sees your card number."
    : "Card payments are processed by Stripe. Your card is saved for your weekly rent charges. Zivo never sees your card number.";
}

/** Reads the saved-method details out of a Stripe payment method object (type + card/cashapp sub-object). */
export type SavedMethod = {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  billingName: string | null;
};

export function extractSavedMethod(pm: any, billingNameFallback: string | null = null): SavedMethod {
  const billing = typeof pm?.billing_details?.name === "string" ? pm.billing_details.name : billingNameFallback;
  if (pm?.type === "cashapp") {
    return { brand: CASH_APP_BRAND, last4: null, expMonth: null, expYear: null, billingName: billing };
  }
  const card = pm?.card;
  return {
    brand: typeof card?.brand === "string" ? card.brand : null,
    last4: typeof card?.last4 === "string" ? card.last4 : null,
    expMonth: Number.isInteger(card?.exp_month) ? card.exp_month : null,
    expYear: Number.isInteger(card?.exp_year) ? card.exp_year : null,
    billingName: billing,
  };
}

/** Escapes % _ and \ so an id can be used as a literal prefix in a SQL LIKE pattern (Stripe ids contain underscores). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
