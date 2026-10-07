import type { SupabaseClient } from "@supabase/supabase-js";
import { chargeSavedCard, stripeConfigured } from "./stripe";

// Charges the renter's saved card for each week of rent as it comes due.
// The database (migration 0080) decides WHAT is due and WHEN; this only moves the money and records the result.

type Claimed = {
  attempt_id: string; tenant_id: string; rental_id: string; customer_id: string; amount_cents: number;
  stripe_customer_id: string; stripe_payment_method_id: string; due_at: string; attempt_no: number;
};

export async function processBilling(db: SupabaseClient): Promise<{ claimed: number; succeeded: number; failed: number; pending: number; skipped?: string }> {
  if (!stripeConfigured()) return { claimed: 0, succeeded: 0, failed: 0, pending: 0, skipped: "stripe_not_configured" };
  const { data, error } = await db.rpc("claim_due_billing", { p_limit: 10 });
  if (error) { console.error("[billing] claim failed:", error.message); return { claimed: 0, succeeded: 0, failed: 0, pending: 0, skipped: "claim_failed" }; }
  const rows = (data ?? []) as Claimed[];
  let succeeded = 0, failed = 0, pending = 0;

  for (const r of rows) {
    try {
      const res = await chargeSavedCard(r.stripe_customer_id, r.stripe_payment_method_id, r.amount_cents, `bill_${r.attempt_id}`, r.attempt_id, r.rental_id);
      if (res.ok === "pending") { pending++; continue; } // stays claimed; picked up again after 15 minutes with the same Stripe key
      const { error: fe } = await db.rpc("finish_billing_attempt", {
        p_attempt_id: r.attempt_id, p_ok: res.ok === true, p_payment_intent: res.ok === true ? res.id : null, p_error: res.ok === true ? null : res.error,
      });
      if (fe) console.error("[billing] finish failed:", r.attempt_id, fe.message);
      if (res.ok === true) succeeded++; else failed++;
    } catch (e) {
      console.error("[billing] exception:", r.attempt_id, (e as Error).message);
      pending++;
    }
  }
  return { claimed: rows.length, succeeded, failed, pending };
}

/** Friendly text for a failed-charge reason, shown to staff. */
export function billingErrorLabel(code: string | null | undefined): string {
  const c = (code ?? "").replace(/^stripe_/, "");
  const map: Record<string, string> = {
    insufficient_funds: "Insufficient funds",
    card_declined: "Card declined",
    generic_decline: "Card declined",
    expired_card: "Card expired",
    lost_card: "Card reported lost",
    stolen_card: "Card reported stolen",
    authentication_required: "Bank wants the renter to approve the charge",
    requires_action: "Bank wants the renter to approve the charge",
    requires_payment_method: "Card was declined",
    incorrect_cvc: "Card declined",
  };
  return map[c] ?? "Charge failed";
}
