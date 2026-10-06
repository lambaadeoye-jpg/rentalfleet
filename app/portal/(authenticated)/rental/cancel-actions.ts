"use server";

import { revalidatePath } from "next/cache";
import { owned } from "./owned";
import { cancelErrorMessage, parseSettlement, processRefunds, type Settlement } from "@/lib/refunds";

// Renter-facing cancel. The reason is always "renter_cancelled" and the amounts always
// come from the database, so nothing sent from the browser can change what is refunded.

export type CancelState = { canCancel: boolean };

export async function getMyCancelState(): Promise<CancelState> {
  const c = await owned();
  return { canCancel: Boolean(c && (c.status === "approved" || c.status === "scheduled") && !c.pickedUp) };
}

type Res = { success: true; settlement: Settlement } | { success: false; error: string };

export async function previewMyCancellation(): Promise<Res> {
  const c = await owned();
  if (!c) return { success: false, error: "Please sign in again." };
  const { data, error } = await c.admin.rpc("request_cancellation", { p_rental_id: c.rentalId, p_reason: "renter_cancelled", p_initiator: "renter", p_note: null, p_dry_run: true });
  if (error) return { success: false, error: cancelErrorMessage(error.message) };
  const s = parseSettlement(Array.isArray(data) ? data[0] : null);
  return s ? { success: true, settlement: s } : { success: false, error: "Couldn't work out the refund." };
}

export async function cancelMyRental(): Promise<Res> {
  const c = await owned();
  if (!c) return { success: false, error: "Please sign in again." };
  const { data, error } = await c.admin.rpc("request_cancellation", { p_rental_id: c.rentalId, p_reason: "renter_cancelled", p_initiator: "renter", p_note: null, p_dry_run: false });
  if (error) return { success: false, error: cancelErrorMessage(error.message) };
  const s = parseSettlement(Array.isArray(data) ? data[0] : null);
  if (!s) return { success: false, error: "Your rental was cancelled. Please contact us about your refund." };
  if (s.status === "approved") await processRefunds(c.admin).catch(() => undefined);
  revalidatePath("/portal/rental");
  return { success: true, settlement: s };
}
