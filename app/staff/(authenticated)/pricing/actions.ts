"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit-log";
import { resolveDeposit, DEPOSIT_MIN_USD, DEPOSIT_MAX_USD } from "@/lib/rental-rate";
import { validatePricingMoney } from "@/lib/pricing-validate";
import { DEFAULT_CANCELLATION_RULES, validateCancellationRules, type CancellationRules } from "@/lib/cancellation-policy";

export type PricingRules = {
  mileage_policy: string;
  deposit_weeks?: number; // legacy, ignored: the deposit is now a fixed amount (see deposit)
  deposit: {
    amount_usd: number | null;
    approved: boolean;
  };
  insurance: {
    insured_discount_pct: number | null;
    uninsured_weekly_deduction_usd: number | null;
    approved: boolean;
  };
  cancellation: CancellationRules;
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
  referral: {
    bonus_usd: number | null;
    approved: boolean;
    cap_type: "unlimited" | "per_period";
    cap_amount_usd: number | null;
    cap_period_days: number | null;
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

  if (!data?.rules) return null;
  // Older policy rows predate the deposit/insurance sections; fill safe,
  // UNAPPROVED defaults so the form renders and nothing is silently priced.
  const r = data.rules as Partial<PricingRules> & Record<string, any>;
  return {
    ...(r as PricingRules),
    deposit: r.deposit ?? { amount_usd: null, approved: false },
    insurance: r.insurance ?? { insured_discount_pct: 22, uninsured_weekly_deduction_usd: null, approved: false },
    // Pre-filled with the owner-approved figures but UNAPPROVED until staff
    // tick the box, like every other new section.
    cancellation: { ...DEFAULT_CANCELLATION_RULES, ...(r.cancellation ?? {}) },
  };
}

// Permission-gated at the database level (migration 0038's
// policy_version_pricing_permission_guard, requiring manage_pricing) --
// only admin has this by default. The UI reflects that, doesn’t duplicate
// it.
export async function updatePricingRules(rules: PricingRules): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  // Server-side validation (the form is not a trust boundary).
  if (!rules || typeof rules !== "object") return { success: false, error: "Couldn’t read the pricing form. Refresh and try again." };
  const moneyProblem = validatePricingMoney(rules);
  if (moneyProblem) return { success: false, error: moneyProblem };
  const dep = rules.deposit;
  if (dep?.approved) {
    const v = resolveDeposit(dep);
    if (!v.ok) return { success: false, error: v.error };
  } else if (dep?.amount_usd != null && !(dep.amount_usd >= DEPOSIT_MIN_USD && dep.amount_usd <= DEPOSIT_MAX_USD)) {
    return { success: false, error: `The deposit must be between $${DEPOSIT_MIN_USD} and $${DEPOSIT_MAX_USD}.` };
  }
  const ins = rules.insurance;
  if (ins) {
    if (ins.insured_discount_pct != null && !(ins.insured_discount_pct >= 0 && ins.insured_discount_pct < 100)) {
      return { success: false, error: "The insured discount must be between 0 and 99 percent." };
    }
    if (ins.uninsured_weekly_deduction_usd != null && !(ins.uninsured_weekly_deduction_usd >= 0)) {
      return { success: false, error: "The weekly insurance deduction can’t be negative." };
    }
    if (ins.approved && (ins.insured_discount_pct == null || ins.uninsured_weekly_deduction_usd == null)) {
      return { success: false, error: "Set both the insured discount and the weekly insurance deduction before approving insurance pricing." };
    }
    if (ins.approved && rules.weekly_rate_usd != null && ins.uninsured_weekly_deduction_usd != null && ins.uninsured_weekly_deduction_usd >= rules.weekly_rate_usd) {
      return { success: false, error: "The weekly insurance deduction must be less than the weekly rate." };
    }
  }

  if (rules.cancellation) {
    const c = validateCancellationRules(rules.cancellation);
    if (!c.ok) return { success: false, error: c.error };
  }

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
      return { success: false, error: "You don’t have permission to change pricing." };
    }
    return { success: false, error: "Couldn’t save. Please try again." };
  }

  if (existing) {
    await logAuditEvent({
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
