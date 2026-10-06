"use server";

import { owned } from "./owned";
import { createPaymentRequest, payLinkUrl } from "@/lib/payment-request";

// Renter-facing "Pay now". The renter is authenticated, their own latest
// rental is looked up under their login, and only then is the service client
// used to create the payment link for that verified rental.

export type PortalPayState = { show: boolean; paid: boolean };

export async function getPortalPayState(): Promise<PortalPayState> {
  const c = await owned();
  if (!c) return { show: false, paid: false };
  const [{ data: setting }, { data: paidReq }] = await Promise.all([
    c.admin.from("tenant_setting").select("value").eq("tenant_id", c.tenantId).eq("key", "payments_enabled").maybeSingle(),
    c.admin.from("pay_request").select("id").eq("rental_id", c.rentalId).eq("status", "paid").limit(1),
  ]);
  const paid = (paidReq ?? []).length > 0;
  const payable = c.status === "approved" || c.status === "scheduled";
  return { show: setting?.value === "on" && payable && !paid, paid };
}

export async function startMyPayment(): Promise<{ success: boolean; url?: string; error?: string }> {
  const c = await owned();
  if (!c) return { success: false, error: "Please sign in again." };
  const res = await createPaymentRequest(c.admin, c.rentalId);
  if (!res.success) return { success: false, error: res.error };
  return { success: true, url: payLinkUrl(res.token) };
}
