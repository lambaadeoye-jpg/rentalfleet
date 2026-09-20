"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit-log";

export type PricingRules = {
  mileage_policy: string;
  deposit_weeks: number;
  daily: {
    first_tier_days: number;
    first_tier_total_usd: number;
    per_day_after_usd: number;
    approved: boolean;
  };
  weekly_rate_usd: number | null;
  weekly_approved: boolean;
  late_fee: {
    grace_days: number;
    amount_usd: number | null;
    approved: boolean;
  };
};

export async function getPricingRules(): Promise<PricingRules | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("policy_version")
    .select("rules")
    .eq("policy_type", "pricing_and_mileage")
    .eq("immutable", false)
    .maybeSingle();

  return (data?.rules as PricingRules) ?? null;
}

// Permission-gated at the database level (migration 0038's
// policy_version_pricing_permission_guard, requiring manage_pricing) --
// only admin has this by default. The UI reflects that, doesn't duplicate
// it.
export async function updatePricingRules(rules: PricingRules): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("policy_version")
    .select("id, tenant_id, rules")
    .eq("policy_type", "pricing_and_mileage")
    .eq("immutable", false)
    .maybeSingle();

  const { error } = await supabase
    .from("policy_version")
    .update({ rules })
    .eq("policy_type", "pricing_and_mileage")
    .eq("immutable", false);

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to change pricing." };
    }
    return { success: false, error: "Couldn't save. Please try again." };
  }

  if (existing) {
    void logAuditEvent({
      tenantId: existing.tenant_id,
      action: "pricing_updated",
      entityType: "policy_version",
      entityId: existing.id,
      beforeData: existing.rules as Record<string, unknown>,
      afterData: rules,
      source: "staff_portal",
    });
  }

  revalidatePath("/staff/pricing");
  return { success: true };
}
