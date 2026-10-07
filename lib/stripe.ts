// Minimal Stripe client over plain HTTPS (no SDK). Server-only.
// Needs STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET for the webhook route).

import { extractSetupCard, type SetupCard } from "./card-update";

const API = "https://api.stripe.com/v1";

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

export type CheckoutSession = { id: string; url: string; expiresAt: number };

export async function createCheckoutSession(body: URLSearchParams, idempotencyKey: string): Promise<{ ok: true; session: CheckoutSession } | { ok: false; error: string }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, error: "not_configured" };
  try {
    const res = await fetch(`${API}/checkout/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idempotencyKey },
      body,
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.id || !json?.url) {
      console.error("[stripe] checkout session failed:", res.status, json?.error?.type, json?.error?.code, json?.error?.message);
      return { ok: false, error: "stripe_error" };
    }
    return { ok: true, session: { id: json.id, url: json.url, expiresAt: Number(json.expires_at) || 0 } };
  } catch (e) {
    console.error("[stripe] network error:", (e as Error).message);
    return { ok: false, error: "network" };
  }
}

export type CardInfo = {
  paymentMethodId: string | null;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  billingName: string | null;
};

/** Reads the saved-card details out of a PaymentIntent fetched with expand[]=latest_charge. */
export function extractCardInfo(pi: any): CardInfo {
  const charge = pi?.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const card = charge?.payment_method_details?.card;
  return {
    paymentMethodId: typeof pi?.payment_method === "string" ? pi.payment_method : null,
    brand: typeof card?.brand === "string" ? card.brand : null,
    last4: typeof card?.last4 === "string" ? card.last4 : null,
    expMonth: Number.isInteger(card?.exp_month) ? card.exp_month : null,
    expYear: Number.isInteger(card?.exp_year) ? card.exp_year : null,
    billingName: typeof charge?.billing_details?.name === "string" ? charge.billing_details.name : null,
  };
}

/** Best-effort: failing here must never block recording a payment that already succeeded. */
export async function fetchCardInfo(paymentIntentId: string): Promise<CardInfo | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) return null;
  try {
    const res = await fetch(`${API}/payment_intents/${paymentIntentId}?expand[]=latest_charge`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return null;
    return extractCardInfo(await res.json());
  } catch {
    return null;
  }
}

/** Best-effort read of the card saved by a setup-mode Checkout session. Returns null on any problem; the webhook then retries. */
export async function fetchSetupIntentCard(setupIntentId: string): Promise<SetupCard | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^seti_[A-Za-z0-9_]+$/.test(setupIntentId)) return null;
  try {
    const res = await fetch(`${API}/setup_intents/${setupIntentId}?expand[]=payment_method`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return null;
    return extractSetupCard(await res.json());
  } catch {
    return null;
  }
}

/** One refund against one PaymentIntent. The idempotency key makes a retry return the same refund instead of refunding twice. */
export async function createRefund(
  paymentIntentId: string, amountCents: number, idempotencyKey: string, refundId: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, error: "not_configured" };
  if (!/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId) || !Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, error: "bad_request" };
  const body = new URLSearchParams({ payment_intent: paymentIntentId, amount: String(amountCents), "metadata[refund_id]": refundId });
  try {
    const res = await fetch(`${API}/refunds`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idempotencyKey },
      body,
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.id) {
      console.error("[stripe] refund failed:", res.status, json?.error?.type, json?.error?.code, json?.error?.message);
      return { ok: false, error: `stripe_${json?.error?.code ?? res.status}`.slice(0, 120) };
    }
    return { ok: true, id: json.id };
  } catch (e) {
    console.error("[stripe] refund network error:", (e as Error).message);
    return { ok: false, error: "network" };
  }
}

export type ChargeResult = { ok: true; id: string } | { ok: false; error: string } | { ok: "pending"; id: string };

/**
 * One off-session charge of a saved card (weekly rent). The idempotency key is per billing attempt, so a retry of a
 * crashed attempt returns the same PaymentIntent instead of charging twice.
 */
export async function chargeSavedCard(
  stripeCustomerId: string, paymentMethodId: string, amountCents: number, idempotencyKey: string, attemptId: string, rentalId: string
): Promise<ChargeResult> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, error: "not_configured" };
  if (!/^cus_[A-Za-z0-9_]+$/.test(stripeCustomerId) || !/^pm_[A-Za-z0-9_]+$/.test(paymentMethodId)
      || !Number.isInteger(amountCents) || amountCents < 50 || amountCents > 500000) return { ok: false, error: "bad_request" };
  const body = new URLSearchParams({
    amount: String(amountCents), currency: "usd", customer: stripeCustomerId, payment_method: paymentMethodId,
    off_session: "true", confirm: "true", "payment_method_types[]": "card",
    description: "Weekly rent", "metadata[billing_attempt_id]": attemptId, "metadata[rental_id]": rentalId,
  });
  try {
    const res = await fetch(`${API}/payment_intents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idempotencyKey },
      body,
    });
    const json: any = await res.json().catch(() => null);
    return interpretChargeResponse(res.ok, res.status, json);
  } catch (e) {
    console.error("[stripe] charge network error:", (e as Error).message);
    return { ok: "pending", id: "" }; // unknown outcome: leave the attempt claimed; the idempotency key makes the retry safe
  }
}

/** Pure mapping from Stripe's response to what billing should do. */
export function interpretChargeResponse(httpOk: boolean, status: number, json: any): ChargeResult {
  if (httpOk && json?.id && json.status === "succeeded") return { ok: true, id: json.id };
  if (httpOk && json?.id && json.status === "processing") return { ok: "pending", id: json.id };
  if (httpOk && json?.id) return { ok: false, error: `stripe_${json.status ?? "unknown"}`.slice(0, 120) };
  if (status >= 500 || status === 429) return { ok: "pending", id: "" };
  const code = json?.error?.decline_code || json?.error?.code || `http_${status}`;
  console.error("[stripe] charge failed:", status, json?.error?.type, json?.error?.code, json?.error?.decline_code);
  return { ok: false, error: `stripe_${code}`.slice(0, 120) };
}
