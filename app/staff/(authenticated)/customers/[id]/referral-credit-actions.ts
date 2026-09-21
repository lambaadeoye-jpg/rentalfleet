"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit-log";

// Applies earned referral credit toward what a customer owes. No payment
// processor exists yet, so this is inherently a staff-assisted step --
// creates the offsetting ledger entry (referral_credit_applied),
// reducing their usable balance. Append-only, same as every other
// financial record here: this doesn't touch the original
// referral_credit_earned entries, it adds a new one alongside them.
export async function applyReferralCredit(
  customerId: string,
  amount: number
): Promise<{ success: boolean; error?: string }> {
  if (amount <= 0) return { success: false, error: "Enter a positive amount." };

  const supabase = await createClient();

  const { data: customer } = await supabase.from("customer").select("id, tenant_id").eq("id", customerId).single();
  if (!customer) return { success: false, error: "Customer not found." };

  const { data: ledgerEntries } = await supabase
    .from("ledger_entry")
    .select("entry_type, amount")
    .eq("customer_id", customerId)
    .in("entry_type", ["referral_credit_earned", "referral_credit_applied"]);

  const balance = (ledgerEntries ?? []).reduce((sum, e) => {
    return e.entry_type === "referral_credit_earned" ? sum + Number(e.amount) : sum - Number(e.amount);
  }, 0);

  if (amount > balance) {
    return { success: false, error: `Only $${balance.toFixed(2)} is available to apply.` };
  }

  const { error } = await supabase.from("ledger_entry").insert({
    tenant_id: customer.tenant_id,
    customer_id: customerId,
    entry_type: "referral_credit_applied",
    amount,
    reference_type: "referral_credit_manual_application",
  });

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to apply credit." };
    }
    return { success: false, error: "Couldn't apply that credit. Please try again." };
  }

  void logAuditEvent({
    tenantId: customer.tenant_id,
    action: "referral_credit_applied",
    entityType: "customer",
    entityId: customerId,
    afterData: { amount },
    source: "staff_portal",
  });

  revalidatePath(`/staff/customers/${customerId}`);
  return { success: true };
}
