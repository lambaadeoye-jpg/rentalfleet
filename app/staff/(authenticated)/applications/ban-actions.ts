"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/staff-role";
import { logAuditEvent } from "@/lib/audit-log";
import { banKeys, validateBanReason } from "@/lib/ban";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActiveBan = { id: string; reason: string; createdAt: string };

/** Active bans that match this customer's phone or email. */
export async function getBansForCustomer(customerId: string): Promise<ActiveBan[]> {
  if (!UUID_RE.test(customerId)) return [];
  const supabase = await createClient();
  const { data: c } = await supabase.from("customer").select("phone, email").eq("id", customerId).maybeSingle();
  if (!c) return [];
  const keys = banKeys(c.phone, c.email);
  const filters = [`customer_id.eq.${customerId}`];
  if (keys.phoneNorm) filters.push(`phone_norm.eq.${keys.phoneNorm}`);
  if (keys.email) filters.push(`email.eq.${keys.email}`);
  const { data } = await supabase.from("rental_ban").select("id, reason, created_at").is("lifted_at", null).or(filters.join(","));
  return (data ?? []).map((b: any) => ({ id: b.id, reason: b.reason, createdAt: b.created_at }));
}

export async function addToDoNotRent(customerId: string, reasonText: string): Promise<{ success: boolean; error?: string }> {
  if (!UUID_RE.test(customerId)) return { success: false, error: "Something went wrong. Please try again." };
  const check = validateBanReason(reasonText);
  if (!check.ok) return { success: false, error: check.error };
  const supabase = await createClient();
  const me = await currentUser(supabase);
  if (!me) return { success: false, error: "Not signed in." };
  const { data: c } = await supabase.from("customer").select("tenant_id, phone, email").eq("id", customerId).maybeSingle();
  if (!c) return { success: false, error: "Customer not found." };
  const keys = banKeys(c.phone, c.email);
  if (!keys.phoneNorm && !keys.email) return { success: false, error: "This customer has no usable phone number or email, so a ban can’t match them." };

  const { error } = await supabase.from("rental_ban").insert({
    tenant_id: c.tenant_id, customer_id: customerId, phone_norm: keys.phoneNorm, email: keys.email, reason: check.reason, created_by: me.id,
  });
  if (error) {
    if (error.message?.toLowerCase().includes("permission")) return { success: false, error: "You don’t have permission to change the do-not-rent list." };
    return { success: false, error: "Couldn’t save. Please try again." };
  }
  await logAuditEvent({ tenantId: c.tenant_id, action: "do_not_rent_added", entityType: "customer", entityId: customerId, afterData: { reason: check.reason }, source: "staff_portal" });
  revalidatePath("/staff/applications");
  return { success: true };
}

export async function liftDoNotRent(banId: string): Promise<{ success: boolean; error?: string }> {
  if (!UUID_RE.test(banId)) return { success: false, error: "Something went wrong. Please try again." };
  const supabase = await createClient();
  const me = await currentUser(supabase);
  if (!me) return { success: false, error: "Not signed in." };
  const { data, error } = await supabase
    .from("rental_ban")
    .update({ lifted_at: new Date().toISOString(), lifted_by: me.id })
    .eq("id", banId)
    .is("lifted_at", null)
    .select("id, tenant_id, customer_id");
  if (error) {
    if (error.message?.toLowerCase().includes("permission")) return { success: false, error: "You don’t have permission to change the do-not-rent list." };
    return { success: false, error: "Couldn’t save. Please try again." };
  }
  if (!data || data.length === 0) return { success: false, error: "That ban was already lifted." };
  await logAuditEvent({ tenantId: data[0].tenant_id, action: "do_not_rent_lifted", entityType: "customer", entityId: data[0].customer_id ?? banId, source: "staff_portal" });
  revalidatePath("/staff/applications");
  return { success: true };
}
