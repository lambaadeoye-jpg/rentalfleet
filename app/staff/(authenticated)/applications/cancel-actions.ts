"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelErrorMessage, parseSettlement, processRefunds, type Settlement } from "@/lib/refunds";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = ["renter_cancelled", "no_show", "requirement_failed", "zivo_cancelled", "fraud_or_identity"];

type Preview = { success: true; settlement: Settlement } | { success: false; error: string };

export async function previewStaffCancellation(rentalId: string, reason: string): Promise<Preview> {
  if (!UUID_RE.test(rentalId) || !REASONS.includes(reason)) return { success: false, error: "Rental not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_cancellation", { p_rental_id: rentalId, p_reason: reason, p_initiator: "staff", p_note: null, p_dry_run: true });
  if (error) return { success: false, error: cancelErrorMessage(error.message) };
  const s = parseSettlement(Array.isArray(data) ? data[0] : null);
  return s ? { success: true, settlement: s } : { success: false, error: "Couldn’t work out the refund." };
}

export async function confirmStaffCancellation(rentalId: string, reason: string, note: string): Promise<Preview & { sendNote?: string }> {
  if (!UUID_RE.test(rentalId) || !REASONS.includes(reason)) return { success: false, error: "Rental not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_cancellation", { p_rental_id: rentalId, p_reason: reason, p_initiator: "staff", p_note: note.trim().slice(0, 500) || null, p_dry_run: false });
  if (error) return { success: false, error: cancelErrorMessage(error.message) };
  const s = parseSettlement(Array.isArray(data) ? data[0] : null);
  if (!s) return { success: false, error: "Cancelled, but couldn’t read the result. Check the Refunds page." };
  let sendNote: string | undefined;
  if (s.status === "approved") {
    const admin = createAdminClient();
    if (admin) { const r = await processRefunds(admin); if (r.failed > 0) sendNote = "The card refund failed. See the Refunds page."; }
  }
  revalidatePath("/staff/applications");
  revalidatePath("/staff/refunds");
  revalidatePath("/staff/pickups");
  return { success: true, settlement: s, sendNote };
}
