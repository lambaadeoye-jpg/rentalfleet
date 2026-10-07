"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processRefunds, cancelErrorMessage } from "@/lib/refunds";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RefundRow = {
  id: string; customerName: string; reason: string; initiatedBy: string; status: string;
  feeCents: number; feeKind: string; rentPaidCents: number; depositPaidCents: number;
  rentRefundCents: number; depositRefundCents: number; totalRefundCents: number; manualCents: number;
  needsAdmin: boolean; staffNote: string | null; reviewNote: string | null; error: string | null; createdAt: string;
};

export async function getRefunds(): Promise<RefundRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("refund")
    .select("id, reason, initiated_by, status, fee_cents, fee_kind, rent_paid_cents, deposit_paid_cents, rent_refund_cents, deposit_refund_cents, total_refund_cents, manual_cents, needs_admin, staff_note, review_note, error, created_at, customer:customer_id(first_name, last_name)")
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((r: any) => ({
    id: r.id, customerName: r.customer ? `${r.customer.first_name} ${r.customer.last_name}` : "Unknown",
    reason: r.reason, initiatedBy: r.initiated_by, status: r.status, feeCents: r.fee_cents, feeKind: r.fee_kind,
    rentPaidCents: r.rent_paid_cents, depositPaidCents: r.deposit_paid_cents, rentRefundCents: r.rent_refund_cents,
    depositRefundCents: r.deposit_refund_cents, totalRefundCents: r.total_refund_cents, manualCents: r.manual_cents,
    needsAdmin: r.needs_admin, staffNote: r.staff_note, reviewNote: r.review_note, error: r.error, createdAt: r.created_at,
  }));
}

type Result = { success: boolean; error?: string; note?: string };

// Sends anything approved right away. The scheduled job is the safety net.
async function sendNow(): Promise<string | undefined> {
  const admin = createAdminClient();
  if (!admin) return "Approved. It will be sent shortly.";
  const r = await processRefunds(admin);
  if (r.skipped === "stripe_not_configured") return "Approved, but Stripe isn’t connected yet, so nothing was sent.";
  if (r.failed > 0) return "Approved, but the card refund failed. See the error on this refund and tap Retry.";
  return undefined;
}

export async function decideRefund(refundId: string, approve: boolean, note: string): Promise<Result> {
  if (!UUID_RE.test(refundId)) return { success: false, error: "Refund not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_refund", { p_refund_id: refundId, p_approve: approve, p_note: note.trim().slice(0, 500) || null });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("not_pending")) return { success: false, error: "This refund was already decided." };
    if (m.includes("manage_pricing_policy")) return { success: false, error: "This refund is over the approval limit. An admin needs to approve it." };
    if (m.includes("Permission denied")) return { success: false, error: "You don’t have permission to approve refunds." };
    return { success: false, error: "Couldn’t save. Please try again." };
  }
  const warn = approve ? await sendNow() : undefined;
  revalidatePath("/staff/refunds");
  return { success: true, note: warn };
}

export async function retryRefund(refundId: string): Promise<Result> {
  if (!UUID_RE.test(refundId)) return { success: false, error: "Refund not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("retry_refund", { p_refund_id: refundId });
  if (error) return { success: false, error: error.message?.includes("not_failed") ? "Only a failed refund can be retried." : "Couldn’t retry. Please try again." };
  const warn = await sendNow();
  revalidatePath("/staff/refunds");
  return { success: true, note: warn };
}

export async function markManualRefundDone(refundId: string, note: string): Promise<Result> {
  if (!UUID_RE.test(refundId)) return { success: false, error: "Refund not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_manual_refund_done", { p_refund_id: refundId, p_note: note.trim().slice(0, 500) || null });
  if (error) return { success: false, error: cancelErrorMessage(error.message) };
  revalidatePath("/staff/refunds");
  return { success: true };
}

export type DepositDue = { rentalId: string; customerName: string; heldCents: number; refundableCents: number; applicationId: string | null; returnedAt: string | null };

/** Returned rentals whose deposit is still held and has no refund yet: the "give it back" to-do list. */
export async function getDepositsDue(): Promise<DepositDue[]> {
  const supabase = await createClient();
  const { data: deposits } = await supabase
    .from("deposit")
    .select("rental_id, amount_collected, refundable_amount, rental:rental_id(customer_id, status, actual_return_at, customer:customer_id(first_name, last_name))")
    .eq("status", "held")
    .limit(200);
  const returned = (deposits ?? []).filter((d: any) => ["returned", "closed"].includes(d.rental?.status));
  if (returned.length === 0) return [];
  const rentalIds = returned.map((d: any) => d.rental_id);
  const customerIds = Array.from(new Set(returned.map((d: any) => d.rental?.customer_id).filter(Boolean)));
  const [{ data: settled }, { data: apps }] = await Promise.all([
    supabase.from("refund").select("rental_id").in("rental_id", rentalIds),
    supabase.from("application").select("id, customer_id, created_at").in("customer_id", customerIds).order("created_at", { ascending: false }),
  ]);
  const done = new Set((settled ?? []).map((r: any) => r.rental_id));
  const appByCustomer = new Map<string, string>();
  for (const a of apps ?? []) if (!appByCustomer.has(a.customer_id)) appByCustomer.set(a.customer_id, a.id);
  return returned
    .filter((d: any) => !done.has(d.rental_id))
    .map((d: any) => ({
      rentalId: d.rental_id,
      customerName: d.rental?.customer ? `${d.rental.customer.first_name} ${d.rental.customer.last_name}` : "Unknown",
      heldCents: Math.round(Number(d.amount_collected) * 100),
      refundableCents: Math.round(Number(d.refundable_amount ?? d.amount_collected) * 100),
      applicationId: appByCustomer.get(d.rental?.customer_id) ?? null,
      returnedAt: d.rental?.actual_return_at ?? null,
    }));
}
