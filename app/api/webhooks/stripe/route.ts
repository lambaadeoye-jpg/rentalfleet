import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCheckoutEvent, verifyStripeSignature } from "@/lib/checkout";
import { fetchCardInfo, fetchSetupIntentCard } from "@/lib/stripe";
import { parseSetupEvent } from "@/lib/card-update";
import { nameMatches } from "@/lib/agreement";
import { processBilling } from "@/lib/billing";

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

  // completed but not paid (delayed methods aren't enabled; card only): nothing to record.
  if (!ev.paid || !ev.payRequestId || !ev.paymentIntentId || ev.amountTotalCents == null) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const card = await fetchCardInfo(ev.paymentIntentId);

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
  if (outcome === "amount_mismatch") console.error("[stripe webhook] AMOUNT MISMATCH for pay request", ev.payRequestId, "- staff review needed");

  if (outcome === "paid" && card) {
    const { error: pmError } = await admin.rpc("save_payment_method", {
      p_request_id: ev.payRequestId, p_stripe_customer: ev.stripeCustomerId, p_pm: card.paymentMethodId,
      p_brand: card.brand, p_last4: card.last4, p_exp_month: card.expMonth, p_exp_year: card.expYear, p_billing_name: card.billingName,
    });
    if (pmError) console.error("[stripe webhook] save card failed:", pmError.message);
  }
  return NextResponse.json({ ok: true, outcome });
}
