import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCheckoutEvent, verifyStripeSignature } from "@/lib/checkout";
import { fetchCardInfo, fetchSetupIntentCard } from "@/lib/stripe";
import { parseSetupEvent } from "@/lib/card-update";
import { nameMatches } from "@/lib/agreement";
import { processBilling, labelCashAppPayments } from "@/lib/billing";
import { parsePaymentAlert, describePaymentAlert } from "@/lib/payment-events";
import { escapeLike, isCashAppBrand } from "@/lib/payment-methods";
import { fireN8nWebhook, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";

export const dynamic = "force-dynamic";

// Stripe calls this after a payment. Signature is checked against the raw body.
// 2xx = handled (or safely ignorable); 5xx = Stripe retries.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret, Math.floor(Date.now() / 1000))) {
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  let raw: unknown;
  try { raw = JSON.parse(payload); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  // A dispute (chargeback) or a refund that failed after Stripe accepted it: record it and alert staff. Nothing else changes.
  const alert = parsePaymentAlert(raw);
  if (alert) {
    const adminAlert = createAdminClient();
    if (!adminAlert) return NextResponse.json({ error: "db_unavailable" }, { status: 500 });
    // Handle each Stripe event once (Stripe retries). A duplicate key means we already did.
    const { error: dupErr } = await adminAlert.from("stripe_event").insert({ id: alert.eventId });
    if (dupErr) {
      if (dupErr.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
      console.error("[stripe webhook] alert dedupe failed:", dupErr.message);
      return NextResponse.json({ error: "db" }, { status: 500 });
    }
    const message = describePaymentAlert(alert);
    console.error("[stripe webhook] PAYMENT ALERT:", alert.kind, alert.paymentIntentId ?? alert.chargeId, message);
    type Found = { tenant_id: string; rental_id: string | null; customer_id: string | null };
    let found = null as Found | null;
    if (alert.paymentIntentId) {
      const { data: rows } = await adminAlert.from("payment").select("tenant_id, rental_id, customer_id")
        .like("provider_payment_id", `${escapeLike(alert.paymentIntentId)}%`).limit(1);
      found = (rows?.[0] as Found | undefined) ?? null;
    }
    if (found) {
      const { error: auditErr } = await adminAlert.from("audit_event").insert({
        tenant_id: found.tenant_id, actor_user_id: null, action: `payment_${alert.kind}`, entity_type: "payment", entity_id: null,
        before_data: null, after_data: { rental_id: found.rental_id, customer_id: found.customer_id, payment_intent: alert.paymentIntentId, charge: alert.chargeId, amount_cents: alert.amountCents, reason: alert.reason, status: alert.status, note: message },
        source: "stripe_webhook",
      });
      if (auditErr) console.error("[stripe webhook] audit insert failed:", auditErr.message);
    }
    await fireN8nWebhook(N8N_WEBHOOK_PATHS.paymentAlert, {
      kind: alert.kind, message, paymentIntentId: alert.paymentIntentId, chargeId: alert.chargeId, amountCents: alert.amountCents,
      reason: alert.reason, status: alert.status, rentalId: found?.rental_id ?? null, customerId: found?.customer_id ?? null,
    });
    return NextResponse.json({ ok: true, alert: alert.kind });
  }

  // A renter saved a new card through an update-card link (setup mode: nothing was charged).
  const setup = parseSetupEvent(raw);
  if (setup) {
    if (!setup.requestId || !setup.setupIntentId) return NextResponse.json({ ok: true, ignored: true });
    const adminSetup = createAdminClient();
    if (!adminSetup) return NextResponse.json({ error: "db_unavailable" }, { status: 500 });
    const saved = await fetchSetupIntentCard(setup.setupIntentId);
    // Could not read the card from Stripe right now: ask Stripe to retry rather than lose it.
    if (!saved?.paymentMethodId) return NextResponse.json({ error: "card_unavailable" }, { status: 500 });
    const { data: outcome, error } = await adminSetup.rpc("complete_card_update", {
      p_event_id: setup.eventId, p_session_id: setup.sessionId, p_request_id: setup.requestId,
      p_stripe_customer: saved.stripeCustomerId ?? setup.stripeCustomerId, p_pm: saved.paymentMethodId,
      p_brand: saved.brand, p_last4: saved.last4, p_exp_month: saved.expMonth, p_exp_year: saved.expYear, p_billing_name: saved.billingName,
    });
    if (error) { console.error("[stripe webhook] card update failed:", error.message); return NextResponse.json({ error: "db" }, { status: 500 }); }
    if (outcome === "not_found") { console.error("[stripe webhook] no matching card update request for", setup.sessionId); return NextResponse.json({ error: "not_found" }, { status: 500 }); }
    // Card saved: retry any failed weekly charge for this renter right away instead of waiting for the next retry slot.
    // Best effort and isolated: the card is already saved, and the regular billing job would pick the charge up anyway.
    if (outcome === "saved") {
      try {
        const { data: reqRow } = await adminSetup.from("card_update_request").select("customer_id").eq("id", setup.requestId).maybeSingle();
        if (reqRow?.customer_id) await processBilling(adminSetup, { customerId: reqRow.customer_id as string });
      } catch (e) {
        console.error("[stripe webhook] immediate retry failed:", (e as Error).message);
      }
    }
    return NextResponse.json({ ok: true, outcome });
  }

  const ev = parseCheckoutEvent(raw);
  if (!ev) return NextResponse.json({ ok: true, ignored: true });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "db_unavailable" }, { status: 500 });

  if (ev.type === "checkout.session.expired") {
    // Harmless for payment sessions; frees an update-card link whose Stripe page timed out.
    await admin.rpc("expire_card_update_session", { p_session_id: ev.sessionId });
    const { error } = await admin.rpc("expire_checkout_session", { p_event_id: ev.eventId, p_session_id: ev.sessionId });
    if (error) { console.error("[stripe webhook] expire failed:", error.message); return NextResponse.json({ error: "db" }, { status: 500 }); }
    return NextResponse.json({ ok: true });
  }

  // completed but not paid: nothing to record. (Cards and Cash App Pay confirm at once; no delayed methods are enabled.)
  if (!ev.paid || !ev.payRequestId || !ev.paymentIntentId || ev.amountTotalCents == null) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  let card = await fetchCardInfo(ev.paymentIntentId);
  if (!card) card = await fetchCardInfo(ev.paymentIntentId); // one quick retry
  if (!card) {
    // Without the card details the renter would be recorded as paid but never get weekly auto-billing.
    // Nothing has been recorded yet, so a 500 makes Stripe send this event again shortly.
    console.error("[stripe webhook] could not read card details for", ev.paymentIntentId, "- asking Stripe to retry");
    return NextResponse.json({ error: "card_lookup_failed" }, { status: 500 });
  }

  // Does the name on the card match the renter? Informational, for staff at pickup.
  let nameOk = false;
  if (card?.billingName) {
    const { data: rows } = await admin.rpc("get_pay_request_names", { p_request_id: ev.payRequestId });
    const n = Array.isArray(rows) ? rows[0] : null;
    if (n) nameOk = nameMatches(card.billingName, n.first_name ?? "", n.last_name ?? "");
  }

  const { data: outcome, error } = await admin.rpc("complete_pay_request", {
    p_event_id: ev.eventId,
    p_session_id: ev.sessionId,
    p_request_id: ev.payRequestId,
    p_payment_intent: ev.paymentIntentId,
    p_amount_total_cents: ev.amountTotalCents,
    p_card_name_matches: nameOk,
  });
  if (error) { console.error("[stripe webhook] complete failed:", error.message); return NextResponse.json({ error: "db" }, { status: 500 }); }
  if (outcome === "not_found") { console.error("[stripe webhook] no matching pay request for", ev.sessionId); return NextResponse.json({ error: "not_found" }, { status: 500 }); }
  if (outcome === "paid_after_cancel") console.error("[stripe webhook] PAYMENT ON A CANCELLED/REVOKED LINK for pay request", ev.payRequestId, "- held for staff review, refund or honour it");
  if (outcome === "amount_mismatch") console.error("[stripe webhook] AMOUNT MISMATCH for pay request", ev.payRequestId, "- staff review needed");

  // The database records every Stripe payment as "card"; correct the label when the renter paid with Cash App.
  if (outcome === "paid" && isCashAppBrand(card.brand)) await labelCashAppPayments(admin, ev.paymentIntentId);

  if (outcome === "paid" && card) {
    const { error: pmError } = await admin.rpc("save_payment_method", {
      p_request_id: ev.payRequestId, p_stripe_customer: ev.stripeCustomerId, p_pm: card.paymentMethodId,
      p_brand: card.brand, p_last4: card.last4, p_exp_month: card.expMonth, p_exp_year: card.expYear, p_billing_name: card.billingName,
    });
    if (pmError) console.error("[stripe webhook] save card failed:", pmError.message);
  }
  return NextResponse.json({ ok: true, outcome });
}
