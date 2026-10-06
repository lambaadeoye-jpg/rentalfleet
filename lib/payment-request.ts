import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { computeCheckoutAmounts, refundTermsLines, type RefundRules } from "./checkout";

// Shared by the staff screen and the renter portal: work out what a rental
// owes up front and create the payment link. `db` is the staff user's client
// (row-level security applies) or the service client (portal, after the caller
// verified the renter owns the rental).

const ERR: Record<string, string> = {
  rent_not_set: "Set the rent for this rental first.",
  deposit_not_set: "Set the deposit for this rental first.",
  nothing_due: "Nothing is due. The rent and deposit are already paid.",
  below_minimum: "The amount due is below the card minimum.",
};

export function paymentErrorMessage(message: string | undefined | null): string {
  const m = message ?? "";
  if (m.includes("payments_disabled")) return "Card payments aren't switched on yet.";
  if (m.includes("agreement_not_signed")) return "The rental agreement must be signed before payment.";
  if (m.includes("rental_not_payable")) return "This rental isn't ready for payment.";
  if (m.includes("rental_not_found")) return "Rental not found.";
  return "Couldn't create the payment link. Please try again.";
}

export type PaymentLinkResult = { success: true; token: string; totalCents: number } | { success: false; error: string };

export async function createPaymentRequest(db: SupabaseClient, rentalId: string): Promise<PaymentLinkResult> {
  const { data: rental } = await db
    .from("rental")
    .select("id, tenant_id, booking_id, agreed_weekly_rate_usd, deposit_required_usd, governing_policy_snapshot")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) return { success: false, error: "Rental not found." };

  const [{ data: booking }, { data: payments }, { data: deposits }] = await Promise.all([
    rental.booking_id ? db.from("booking").select("quoted_amount").eq("id", rental.booking_id).maybeSingle() : Promise.resolve({ data: null as any }),
    db.from("payment").select("amount, kind").eq("rental_id", rentalId).eq("status", "paid"),
    db.from("deposit").select("amount_collected").eq("rental_id", rentalId),
  ]);

  const rentPaid = (payments ?? []).filter((p: any) => p.kind === "rent").reduce((s: number, p: any) => s + Number(p.amount), 0);
  const depositCollected = (deposits ?? []).reduce((s: number, d: any) => s + Number(d.amount_collected ?? 0), 0);

  const amounts = computeCheckoutAmounts({
    weeklyRateUsd: rental.agreed_weekly_rate_usd != null ? Number(rental.agreed_weekly_rate_usd) : null,
    quotedTotalUsd: booking?.quoted_amount != null ? Number(booking.quoted_amount) : null,
    depositRequiredUsd: rental.deposit_required_usd != null ? Number(rental.deposit_required_usd) : null,
    depositCollectedUsd: depositCollected,
    rentPaidUsd: rentPaid,
  });
  if (!amounts.ok) return { success: false, error: ERR[amounts.error] ?? "Couldn't work out the amount due." };

  let rules = ((rental.governing_policy_snapshot as any)?.cancellation ?? null) as RefundRules | null;
  if (!rules || rules.approved !== true) {
    const { data: policy } = await db.from("policy_version").select("rules").eq("tenant_id", rental.tenant_id).eq("policy_type", "pricing_and_mileage").maybeSingle();
    rules = ((policy?.rules as any)?.cancellation ?? null) as RefundRules | null;
  }
  const terms = refundTermsLines(rules);
  if (!terms) return { success: false, error: "Approve the cancellation and refund rules on the Pricing page first." };

  const token = randomBytes(32).toString("base64url");
  const { error } = await db.rpc("create_pay_request", {
    p_rental_id: rentalId,
    p_token_hash: createHash("sha256").update(token).digest("hex"),
    p_rent_cents: amounts.rentCents,
    p_deposit_cents: amounts.depositCents,
    p_terms: terms,
    p_terms_hash: createHash("sha256").update(JSON.stringify(terms)).digest("hex"),
    p_hours: 72,
  });
  if (error) return { success: false, error: paymentErrorMessage(error.message) };
  return { success: true, token, totalCents: amounts.totalCents };
}

export function payLinkUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://rentzivo.com").replace(/\/$/, "");
  return `${base}/pay/${token}`;
}
