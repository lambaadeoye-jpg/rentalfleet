import type { SupabaseClient } from "@supabase/supabase-js";
import { createRefund, stripeConfigured } from "./stripe";

// Sends approved refunds to Stripe. The database decides WHAT is owed
// (migration 0078); this only moves the money and records the result.

export type Intent = { pi: string; paid_cents: number };

/** Splits the card refund across the PaymentIntents the renter paid with. Null when the card paid less than we are asked to refund. */
export function allocateRefund(intents: Intent[], totalCents: number): { pi: string; cents: number }[] | null {
  if (!Number.isInteger(totalCents) || totalCents < 0) return null;
  let remaining = totalCents;
  const out: { pi: string; cents: number }[] = [];
  for (const i of [...intents].sort((a, b) => a.pi.localeCompare(b.pi))) {
    if (remaining === 0) break;
    const take = Math.min(remaining, Math.max(0, i.paid_cents));
    if (take > 0) { out.push({ pi: i.pi, cents: take }); remaining -= take; }
  }
  return remaining === 0 ? out : null;
}

type Claimed = { refund_id: string; card_cents: number; intents: Intent[] | null };

export async function processRefunds(db: SupabaseClient): Promise<{ claimed: number; succeeded: number; failed: number; skipped?: string }> {
  if (!stripeConfigured()) return { claimed: 0, succeeded: 0, failed: 0, skipped: "stripe_not_configured" };
  const { data, error } = await db.rpc("claim_approved_refunds", { p_limit: 10 });
  if (error) { console.error("[refunds] claim failed:", error.message); return { claimed: 0, succeeded: 0, failed: 0, skipped: "claim_failed" }; }
  const rows = (data ?? []) as Claimed[];
  let succeeded = 0, failed = 0;

  for (const r of rows) {
    const finish = async (ok: boolean, ids: string[], err?: string) => {
      const { error: fe } = await db.rpc("finish_refund", { p_refund_id: r.refund_id, p_ok: ok, p_stripe_refund_ids: ids, p_error: err ?? null });
      if (fe) console.error("[refunds] finish failed:", r.refund_id, fe.message);
      if (ok) succeeded++; else failed++;
    };
    try {
      if (r.card_cents === 0) { await finish(true, []); continue; }
      const parts = allocateRefund(r.intents ?? [], r.card_cents);
      if (!parts) { await finish(false, [], "card_payments_do_not_cover_refund"); continue; }
      const ids: string[] = [];
      let failure: string | null = null;
      for (const p of parts) {
        const res = await createRefund(p.pi, p.cents, `refund_${r.refund_id}_${p.pi}`, r.refund_id);
        if (!res.ok) { failure = res.error; break; }
        ids.push(res.id);
      }
      if (failure) await finish(false, ids, failure); else await finish(true, ids);
    } catch (e) {
      // Left in 'processing': claimed again after 15 minutes; Stripe's idempotency key prevents a double refund.
      console.error("[refunds] exception:", r.refund_id, (e as Error).message);
      failed++;
    }
  }
  return { claimed: rows.length, succeeded, failed };
}

export const REASON_LABELS: Record<string, string> = {
  renter_cancelled: "Renter cancelled",
  no_show: "No-show",
  requirement_failed: "Failed a pickup requirement",
  zivo_cancelled: "Zivo cancelled / no car ready",
  fraud_or_identity: "Fraud or identity problem",
  rental_ended: "Deposit return (rental ended)",
};

export function cancelErrorMessage(message: string | undefined | null): string {
  const m = message ?? "";
  if (m.includes("not_cancellable")) return "This rental can't be cancelled here. It may already be picked up or closed.";
  if (m.includes("already_cancelled")) return "This rental has already been cancelled.";
  if (m.includes("rules_not_approved")) return "The cancellation and refund rules aren't approved yet. Approve them on the Pricing page first.";
  if (m.includes("Permission denied")) return "You don't have permission to cancel rentals or issue refunds.";
  if (m.includes("rental_not_found")) return "Rental not found.";
  if (m.includes("invalid_reason")) return "That cancellation reason isn't allowed.";
  return "Couldn't cancel. Please try again.";
}

export type Settlement = {
  feeCents: number; feeKind: "none" | "early" | "late"; rentRefundCents: number; depositRefundCents: number;
  totalRefundCents: number; manualCents: number; status: string; needsAdmin: boolean; vehicleReleased: boolean; refundId: string | null;
};

export function parseSettlement(row: any): Settlement | null {
  if (!row) return null;
  return {
    feeCents: row.fee_cents, feeKind: row.fee_kind, rentRefundCents: row.rent_refund_cents, depositRefundCents: row.deposit_refund_cents,
    totalRefundCents: row.total_refund_cents, manualCents: row.manual_cents, status: row.status, needsAdmin: row.needs_admin,
    vehicleReleased: row.vehicle_released, refundId: row.refund_id ?? null,
  };
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Plain-language summary shown before a renter or staff member confirms. */
export function settlementSummary(s: Settlement): string {
  if (s.totalRefundCents === 0 && s.feeCents === 0) return "Nothing has been paid on this rental, so there is nothing to refund.";
  const kept = s.feeCents > 0 && s.rentRefundCents === 0;
  const fee = kept ? `The rent paid (${usd(s.feeCents)}) is not refunded under the rental agreement. ` : s.feeCents > 0 ? `A ${usd(s.feeCents)} ${s.feeKind === "early" ? "cancellation" : "late-cancellation"} fee is kept from the rent. ` : "No fee applies. ";
  if (s.totalRefundCents === 0) return `${fee}Nothing goes back to the card.`;
  return `${fee}${usd(s.totalRefundCents)} goes back to the original card${s.depositRefundCents > 0 ? `, including the ${usd(s.depositRefundCents)} deposit in full` : ""}.`;
}

// ---- Deposit return after a finished rental (migration 0082) ----

export type DepositReturn = {
  refundId: string | null; depositRefundCents: number; deductionsCents: number; manualCents: number; status: string; needsAdmin: boolean;
};

export function parseDepositReturn(row: any): DepositReturn | null {
  if (!row) return null;
  return {
    refundId: row.refund_id ?? null, depositRefundCents: row.deposit_refund_cents, deductionsCents: row.deductions_cents,
    manualCents: row.manual_cents, status: row.status, needsAdmin: row.needs_admin,
  };
}

export function depositReturnSummary(d: DepositReturn): string {
  if (d.depositRefundCents === 0) return "There is no deposit left to return" + (d.deductionsCents > 0 ? ` (${usd(d.deductionsCents)} was deducted).` : ".");
  const ded = d.deductionsCents > 0 ? ` after ${usd(d.deductionsCents)} of approved deductions` : "";
  return `${usd(d.depositRefundCents)} of the deposit goes back to the renter${ded}. Weekly rent already paid is not refunded.`;
}

export function settleErrorMessage(message: string | undefined | null): string {
  const m = message ?? "";
  if (m.includes("not_returned")) return "Confirm the vehicle dropoff first. The deposit can only be returned once the rental is returned.";
  if (m.includes("already_settled")) return "The deposit for this rental has already been settled. See the Refunds page.";
  if (m.includes("pending_charges")) return "A charge on this rental is still waiting for approval. Approve or reject it on the Charges page first, so it can come out of the deposit.";
  if (m.includes("Permission denied")) return "You don't have permission to return deposits.";
  if (m.includes("rental_not_found")) return "Rental not found.";
  return "Couldn't settle the deposit. Please try again.";
}
