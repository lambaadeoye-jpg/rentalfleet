"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { stripeConfigured } from "@/lib/stripe";

export type PaymentSettings = { enabled: boolean; requireSignature: boolean; slotRequiresPayment: boolean; stripeReady: boolean };

export async function getPaymentSettings(): Promise<PaymentSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from("tenant_setting").select("key, value").in("key", ["payments_enabled", "payments_require_signature", "slot_require_payment"]);
  const m = Object.fromEntries((data ?? []).map((s) => [s.key, s.value ?? ""]));
  return {
    enabled: m.payments_enabled === "on",
    requireSignature: m.payments_require_signature !== "off",
    slotRequiresPayment: m.slot_require_payment === "on",
    stripeReady: stripeConfigured(),
  };
}

export async function savePaymentSettings(enabled: boolean, slotRequiresPayment: boolean): Promise<{ success: boolean; error?: string }> {
  if ((enabled || slotRequiresPayment) && !stripeConfigured()) {
    return { success: false, error: "Add the Stripe keys in Netlify first (STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET), then switch this on." };
  }
  // Holding a pickup time "until paid" is pointless if nobody can pay.
  if (slotRequiresPayment && !enabled) return { success: false, error: "Turn on card payments before requiring payment for pickup times." };
  const supabase = await createClient();
  const { data: tenantRow } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenantRow) return { success: false, error: "Something went wrong. Please try again." };
  const { error } = await supabase.from("tenant_setting").upsert(
    [
      { tenant_id: tenantRow.id, key: "payments_enabled", value: enabled ? "on" : "off" },
      { tenant_id: tenantRow.id, key: "slot_require_payment", value: slotRequiresPayment ? "on" : "off" },
    ],
    { onConflict: "tenant_id,key" }
  );
  if (error) {
    if (error.message?.toLowerCase().includes("permission")) return { success: false, error: "You don’t have permission to change this setting." };
    return { success: false, error: "Couldn’t save. Please try again." };
  }
  revalidatePath("/staff/settings");
  return { success: true };
}
