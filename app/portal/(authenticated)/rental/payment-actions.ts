"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPaymentRequest, payLinkUrl } from "@/lib/payment-request";

// Renter-facing "Pay now". The renter is authenticated, their own latest
// rental is looked up under their login, and only then is the service client
// used to create the payment link for that verified rental.

async function owned() {
  const admin = createAdminClient();
  if (!admin) return null;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;
  const { data: customer } = await supabase.from("customer").select("id, tenant_id").eq("auth_user_id", auth.user.id).maybeSingle();
  if (!customer) return null;
  const { data: rental } = await supabase.from("rental").select("id, status").eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!rental) return null;
  return { admin, tenantId: customer.tenant_id as string, rentalId: rental.id as string, status: rental.status as string };
}

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
