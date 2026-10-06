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
  if (r.skipped === "stripe_not_configured") return "Approved, but Stripe isn't connected yet, so nothing was sent.";
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
    if (m.includes("Permission denied")) return { success: false, error: "You don't have permission to approve refunds." };
    return { success: false, error: "Couldn't save. Please try again." };
  }
  const warn = approve ? await sendNow() : undefined;
  revalidatePath("/staff/refunds");
  return { success: true, note: warn };
}

export async function retryRefund(refundId: string): Promise<Result> {
  if (!UUID_RE.test(refundId)) return { success: false, error: "Refund not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("retry_refund", { p_refund_id: refundId });
  if (error) return { success: false, error: error.message?.includes("not_failed") ? "Only a failed refund can be retried." : "Couldn't retry. Please try again." };
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
