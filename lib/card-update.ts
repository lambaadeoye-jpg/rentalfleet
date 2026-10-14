// Update-card links (migration 0086): pure helpers so the Stripe request, the webhook parsing and the wording are
// unit-tested. Stripe is called over plain HTTPS from lib/stripe.ts.

import { extractSavedMethod } from "./payment-methods";

export const CARD_SESSION_MINUTES = 60;
export const CARD_LINK_HOURS = 72;

/** Shown (and ticked) before the renter is sent to Stripe. DRAFT: counsel approves this with the agreement wording. */
export const CARD_AUTHORIZATION_TEXT =
  "I authorize Zivo to save this card and charge it for my weekly rent and any other amounts due under my rental agreement. " +
  "My card is not charged today.";

/** Same consent for a Cash App account. DRAFT: counsel approves this with the agreement wording before Cash App goes live. */
export const CASH_APP_AUTHORIZATION_TEXT =
  "I authorize Zivo to save this card or Cash App account and charge it for my weekly rent and any other amounts due under my rental agreement. " +
  "Nothing is charged today.";

export function cardAuthorizationText(cashApp: boolean): string {
  return cashApp ? CASH_APP_AUTHORIZATION_TEXT : CARD_AUTHORIZATION_TEXT;
}

export function cardUpdateUrl(token: string, siteUrl?: string | null): string {
  const base = (siteUrl || process.env.NEXT_PUBLIC_SITE_URL || "https://rentzivo.com").replace(/\/$/, "");
  return `${base}/card/${token}`;
}

export type SetupParams = {
  requestId: string;
  stripeCustomerId: string | null;
  email: string | null;
  successUrl: string;
  cancelUrl: string;
  nowSeconds: number;
  /** Stripe may refuse an email in some setups; the caller retries once without it. */
  includeEmail: boolean;
  /** Stripe payment method types to offer. Defaults to card only; callers pass paymentMethodTypes(). */
  methodTypes?: string[];
};

/** Form-encoded body for POST /v1/checkout/sessions in setup mode: saves a card, charges nothing. */
export function buildSetupSessionBody(p: SetupParams): URLSearchParams {
  const b = new URLSearchParams();
  b.set("mode", "setup");
  b.set("success_url", p.successUrl);
  b.set("cancel_url", p.cancelUrl);
  b.set("client_reference_id", p.requestId);
  (p.methodTypes?.length ? p.methodTypes : ["card"]).forEach((t, n) => b.set(`payment_method_types[${n}]`, t));
  b.set("setup_intent_data[metadata][card_update_request_id]", p.requestId);
  b.set("metadata[card_update_request_id]", p.requestId);
  if (p.stripeCustomerId && /^cus_[A-Za-z0-9_]+$/.test(p.stripeCustomerId)) b.set("customer", p.stripeCustomerId);
  else if (p.includeEmail && p.email) b.set("customer_email", p.email);
  b.set("expires_at", String(p.nowSeconds + CARD_SESSION_MINUTES * 60));
  return b;
}

export type SetupCompleted = {
  eventId: string;
  sessionId: string;
  requestId: string | null;
  setupIntentId: string | null;
  stripeCustomerId: string | null;
};

/** A finished setup-mode Checkout session. Returns null for any other event. */
export function parseSetupEvent(raw: unknown): SetupCompleted | null {
  const e = raw as any;
  if (!e || typeof e.id !== "string" || e.type !== "checkout.session.completed") return null;
  const s = e.data?.object;
  if (!s || typeof s.id !== "string" || s.mode !== "setup") return null;
  const ref = s.client_reference_id ?? s.metadata?.card_update_request_id ?? null;
  return {
    eventId: e.id,
    sessionId: s.id,
    requestId: typeof ref === "string" ? ref : null,
    setupIntentId: typeof s.setup_intent === "string" ? s.setup_intent : null,
    stripeCustomerId: typeof s.customer === "string" ? s.customer : null,
  };
}

export type SetupCard = {
  paymentMethodId: string | null;
  stripeCustomerId: string | null;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  billingName: string | null;
};

/** Reads the saved card out of a SetupIntent fetched with expand[]=payment_method. */
export function extractSetupCard(si: any): SetupCard {
  const pm = si?.payment_method && typeof si.payment_method === "object" ? si.payment_method : null;
  const saved = extractSavedMethod(pm);
  return {
    paymentMethodId: typeof pm?.id === "string" ? pm.id : typeof si?.payment_method === "string" ? si.payment_method : null,
    stripeCustomerId: typeof si?.customer === "string" ? si.customer : typeof si?.customer?.id === "string" ? si.customer.id : null,
    ...saved,
  };
}
