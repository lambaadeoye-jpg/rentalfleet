// Payment helpers (Phase 3D): what a renter owes up front, the Stripe Checkout
// request, refund terms shown before paying, and webhook signature checking.
// Pure functions (crypto aside) so every money rule is unit-tested. Stripe is
// called over plain HTTPS from lib/stripe.ts; no SDK.

import { createHmac, timingSafeEqual } from "node:crypto";
import { money } from "./agreement";

export const MIN_CHARGE_CENTS = 50; // Stripe's minimum for USD
export const CHECKOUT_MINUTES = 60;

const toCents = (usd: number) => Math.round(usd * 100);

export type AmountsInput = {
  weeklyRateUsd: number | null;
  quotedTotalUsd: number | null; // daily plan: total for the 7-day term
  depositRequiredUsd: number | null;
  depositCollectedUsd: number;
  rentPaidUsd: number;
};

export type AmountsResult =
  | { ok: true; rentCents: number; depositCents: number; totalCents: number }
  | { ok: false; error: "rent_not_set" | "deposit_not_set" | "nothing_due" | "below_minimum" };

/** Up-front amount: the first week's rent (or the daily-plan total) plus the deposit, minus anything already paid. */
export function computeCheckoutAmounts(i: AmountsInput): AmountsResult {
  const rentTotal = i.weeklyRateUsd ?? i.quotedTotalUsd;
  if (rentTotal == null || !(rentTotal > 0)) return { ok: false, error: "rent_not_set" };
  if (i.depositRequiredUsd == null || i.depositRequiredUsd < 0) return { ok: false, error: "deposit_not_set" };
  const rentCents = Math.max(0, toCents(rentTotal) - toCents(Math.max(0, i.rentPaidUsd)));
  const depositCents = Math.max(0, toCents(i.depositRequiredUsd) - toCents(Math.max(0, i.depositCollectedUsd)));
  const totalCents = rentCents + depositCents;
  if (totalCents === 0) return { ok: false, error: "nothing_due" };
  if (totalCents < MIN_CHARGE_CENTS) return { ok: false, error: "below_minimum" };
  return { ok: true, rentCents, depositCents, totalCents };
}

// ---- refund terms shown (and ticked) before paying -------------------------

export type RefundRules = {
  approved?: boolean; late_fee_usd?: number | null; early_fee_usd?: number | null; free_cancellations_per_90d?: number;
  late_window_hours?: number; noshow_grace_hours?: number; rebook_days?: number;
  no_refund?: boolean;
};

/** Plain-language terms from the approved cancellation policy. Returns null until the policy is approved and complete. */
export function refundTermsLines(r: RefundRules | null | undefined): string[] | null {
  if (!r || r.approved !== true) return null;
  if (r.no_refund === true) {
    return [
      "Rent is not refunded if you cancel after reserving, don't arrive for pickup, or can't meet a stated requirement at pickup (valid license, a card in your own name, required documents).",
      "If Zivo cancels or can't provide the vehicle, or a payment turns out not to have been made by you, you get a full refund of what you paid for it.",
      "Your security deposit is returned in full if you cancel before pickup. After pickup it covers damage and charges, and you lose all of it for a late return, any damage or smoking in the car, as the rental agreement says.",
      "If the vehicle breaks down during your rental, we extend the rental to make up the lost time. If your negligence caused it, we may cancel the rest of the rental without a refund.",
      "Rent already paid for a started week is not prorated or refunded after pickup. Refunds go to the original card only.",
    ];
  }
  const need = [r.late_fee_usd, r.early_fee_usd, r.free_cancellations_per_90d, r.late_window_hours, r.noshow_grace_hours, r.rebook_days];
  if (need.some((n) => n === null || n === undefined)) return null;
  return [
    `Cancel more than ${r.late_window_hours} hours before pickup: full refund of rent paid. You get ${r.free_cancellations_per_90d} free cancellations in any 90 days; after that we keep ${money(r.early_fee_usd as number)}.`,
    `Cancel within ${r.late_window_hours} hours of pickup, or arrive more than ${r.noshow_grace_hours} hours late: we keep ${money(r.late_fee_usd as number)} from the rent paid (never more than you paid). You can rebook within ${r.rebook_days} days.`,
    `If you can't meet a stated requirement at pickup (valid license, a card in your own name, required documents): we keep ${money(r.late_fee_usd as number)} once and refund the rest.`,
    "If Zivo cancels or can't provide the vehicle, you pay no fee and get a full refund.",
    "The refundable deposit is always returned in full if you cancel before pickup.",
    "Rent already paid for a started week is not prorated or refunded after pickup. Refunds go to the original card only.",
  ];
}

// ---- Stripe Checkout request ----------------------------------------------

export type CheckoutParams = {
  payRequestId: string;
  rentalId: string;
  rentCents: number;
  depositCents: number;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
  nowSeconds: number;
};

/** Form-encoded body for POST /v1/checkout/sessions. Card only; the card is saved for later charges. */
export function buildCheckoutBody(p: CheckoutParams): URLSearchParams {
  const b = new URLSearchParams();
  b.set("mode", "payment");
  b.set("success_url", p.successUrl);
  b.set("cancel_url", p.cancelUrl);
  b.set("client_reference_id", p.payRequestId);
  b.set("customer_creation", "always");
  if (p.customerEmail) b.set("customer_email", p.customerEmail);
  b.set("payment_method_types[0]", "card");
  b.set("payment_intent_data[setup_future_usage]", "off_session");
  b.set("payment_intent_data[description]", "Zivo vehicle rental");
  b.set("payment_intent_data[metadata][pay_request_id]", p.payRequestId);
  b.set("payment_intent_data[metadata][rental_id]", p.rentalId);
  b.set("metadata[pay_request_id]", p.payRequestId);
  b.set("metadata[rental_id]", p.rentalId);
  b.set("expires_at", String(p.nowSeconds + CHECKOUT_MINUTES * 60));
  let i = 0;
  const line = (name: string, cents: number) => {
    b.set(`line_items[${i}][price_data][currency]`, "usd");
    b.set(`line_items[${i}][price_data][unit_amount]`, String(cents));
    b.set(`line_items[${i}][price_data][product_data][name]`, name);
    b.set(`line_items[${i}][quantity]`, "1");
    i++;
  };
  if (p.rentCents > 0) line("Rent (first week)", p.rentCents);
  if (p.depositCents > 0) line("Refundable deposit", p.depositCents);
  return b;
}

// ---- webhook signature ------------------------------------------------------

export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** Stripe-Signature header: "t=timestamp,v1=hex[,v1=hex]". HMAC-SHA256 over "t.payload". */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSeconds: number): boolean {
  if (!header || !secret) return false;
  let t: string | null = null;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!t || sigs.length === 0 || !/^\d{1,12}$/.test(t)) return false;
  if (Math.abs(nowSeconds - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest();
  return sigs.some((s) => {
    if (!/^[0-9a-f]{64}$/i.test(s)) return false;
    return timingSafeEqual(expected, Buffer.from(s, "hex"));
  });
}

export type CheckoutCompleted = {
  eventId: string;
  type: "checkout.session.completed" | "checkout.session.expired";
  sessionId: string;
  payRequestId: string | null;
  paymentIntentId: string | null;
  stripeCustomerId: string | null;
  amountTotalCents: number | null;
  paid: boolean;
};

/** Pulls only what we use out of a Stripe event. Returns null for anything else. */
export function parseCheckoutEvent(raw: unknown): CheckoutCompleted | null {
  const e = raw as any;
  if (!e || typeof e.id !== "string" || typeof e.type !== "string") return null;
  if (e.type !== "checkout.session.completed" && e.type !== "checkout.session.expired") return null;
  const s = e.data?.object;
  if (!s || typeof s.id !== "string") return null;
  const ref = s.client_reference_id ?? s.metadata?.pay_request_id ?? null;
  return {
    eventId: e.id,
    type: e.type,
    sessionId: s.id,
    payRequestId: typeof ref === "string" ? ref : null,
    paymentIntentId: typeof s.payment_intent === "string" ? s.payment_intent : null,
    stripeCustomerId: typeof s.customer === "string" ? s.customer : null,
    amountTotalCents: Number.isInteger(s.amount_total) ? s.amount_total : null,
    paid: e.type === "checkout.session.completed" && s.payment_status === "paid",
  };
}
