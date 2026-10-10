"use server";

import { owned } from "./owned";
import { createPaymentRequest, payLinkUrl } from "@/lib/payment-request";
import { buildSigningLink } from "@/lib/signing-link";
import { loadWeeklyOffer, performWeeklySwitch, switchMessage, type WeeklyOffer } from "@/lib/weekly-switch";
import { revalidatePath } from "next/cache";

// Renter-facing "Pay now". The renter is authenticated, their own latest
// rental is looked up under their login, and only then is the service client
// used to create the payment link for that verified rental.

export type PortalPayState = { show: boolean; paid: boolean; needsSignature: boolean };

export async function getPortalPayState(): Promise<PortalPayState> {
  const c = await owned();
  if (!c) return { show: false, paid: false, needsSignature: false };
  const [{ data: setting }, { data: paidReq }, { data: signedDoc }] = await Promise.all([
    c.admin.from("tenant_setting").select("value").eq("tenant_id", c.tenantId).eq("key", "payments_enabled").maybeSingle(),
    c.admin.from("pay_request").select("id").eq("rental_id", c.rentalId).eq("status", "paid").limit(1),
    c.admin.from("signed_document").select("id").eq("rental_id", c.rentalId).not("sign_request_id", "is", null).limit(1),
  ]);
  const paid = (paidReq ?? []).length > 0;
  const payable = c.status === "approved" || c.status === "scheduled";
  const needsSignature = payable && (signedDoc ?? []).length === 0;
  return { show: setting?.value === "on" && payable && !paid, paid, needsSignature };
}

export async function startMyPayment(): Promise<{ success: boolean; url?: string; error?: string }> {
  const c = await owned();
  if (!c) return { success: false, error: "Please sign in again." };
  const res = await createPaymentRequest(c.admin, c.rentalId);
  if (!res.success) return { success: false, error: res.error };
  return { success: true, url: payLinkUrl(res.token) };
}

// Renter-facing "Sign my agreement": builds the agreement for the renter's own rental and returns the link.
export async function startMySigning(): Promise<{ success: boolean; url?: string; error?: string }> {
  const c = await owned();
  if (!c) return { success: false, error: "Please sign in again." };
  const res = await buildSigningLink(c.admin, c.rentalId);
  if (!res.success) {
    return { success: false, error: res.error?.startsWith("The agreement can’t be created yet") ? "Your agreement isn’t ready yet. We’ll let you know when it is." : res.error };
  }
  return res;
}

// Day-3 offer: move from the daily plan to the weekly plan. Only the renter's own rental; the price, the consent
// wording and every rule are worked out on the server (the browser only says "yes").
export async function getMyWeeklyOffer(): Promise<WeeklyOffer> {
  const c = await owned();
  if (!c || !["active", "extended"].includes(c.status)) return { available: false };
  return loadWeeklyOffer(c.admin, c.rentalId, { by: "renter" });
}

export async function switchMyPlanToWeekly(agreed: boolean): Promise<{ success: boolean; error?: string }> {
  if (agreed !== true) return { success: false, error: "Please tick the box to confirm." };
  const c = await owned();
  if (!c) return { success: false, error: "Please sign in again." };
  const res = await performWeeklySwitch(c.admin, c.rentalId, "renter", null);
  if (res.outcome !== "switched") return { success: false, error: switchMessage(res.outcome) };
  revalidatePath("/portal/rental");
  revalidatePath("/portal/money");
  return { success: true };
}
