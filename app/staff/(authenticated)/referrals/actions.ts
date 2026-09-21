"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit-log";

export type PendingReferral = {
  id: string;
  referrerName: string;
  referredName: string;
  qualifiedAt: string | null;
};

export async function getQualifiedReferrals(): Promise<PendingReferral[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("referral")
    .select("id, qualified_at, referrer:referrer_customer_id(first_name, last_name), lead:referred_lead_id(first_name, last_name)")
    .eq("status", "qualified")
    .order("qualified_at", { ascending: true });

  return (data ?? []).map((r) => {
    const referrer = r.referrer as any;
    const lead = r.lead as any;
    return {
      id: r.id,
      referrerName: `${referrer?.first_name ?? ""} ${referrer?.last_name ?? ""}`.trim() || "Unknown",
      referredName: `${lead?.first_name ?? ""} ${lead?.last_name ?? ""}`.trim() || "Unknown",
      qualifiedAt: r.qualified_at,
    };
  });
}

export async function getReferralBonusAmount(): Promise<number | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("policy_version")
    .select("rules")
    .eq("policy_type", "pricing_and_mileage")
    .eq("immutable", false)
    .maybeSingle();

  const referral = (data?.rules as any)?.referral;
  if (!referral?.approved || !referral?.bonus_usd) return null;
  return referral.bonus_usd;
}

async function checkReferralCap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  referrerCustomerId: string,
  bonusAmount: number
): Promise<{ ok: boolean; error?: string }> {
  const { data } = await supabase
    .from("policy_version")
    .select("rules")
    .eq("policy_type", "pricing_and_mileage")
    .eq("immutable", false)
    .maybeSingle();

  const referral = (data?.rules as any)?.referral;
  if (!referral || referral.cap_type !== "per_period" || !referral.cap_amount_usd || !referral.cap_period_days) {
    return { ok: true };
  }

  const periodStart = new Date(Date.now() - referral.cap_period_days * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentCredits } = await supabase
    .from("ledger_entry")
    .select("amount")
    .eq("customer_id", referrerCustomerId)
    .eq("entry_type", "referral_credit_earned")
    .gte("created_at", periodStart);

  const alreadyEarned = (recentCredits ?? []).reduce((sum, e) => sum + Number(e.amount), 0);
  if (alreadyEarned + bonusAmount > referral.cap_amount_usd) {
    return {
      ok: false,
      error: `This would exceed the $${referral.cap_amount_usd} cap for this referrer over the last ${referral.cap_period_days} days (already earned $${alreadyEarned.toFixed(2)}).`,
    };
  }
  return { ok: true };
}

// Permission-gated at the database level (migration 0046's
// referral_approval_guard, requiring approve_charge -- same permission
// as approving any other pending financial benefit).
export async function approveReferral(referralId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const bonusAmount = await getReferralBonusAmount();
  if (!bonusAmount) {
    return { success: false, error: "Set and approve a referral bonus amount on the Pricing page first." };
  }

  const { data: referral } = await supabase
    .from("referral")
    .select("id, tenant_id, referrer_customer_id")
    .eq("id", referralId)
    .single();

  if (!referral) return { success: false, error: "Referral not found." };

  const capCheck = await checkReferralCap(supabase, referral.referrer_customer_id, bonusAmount);
  if (!capCheck.ok) {
    return { success: false, error: capCheck.error };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("referral")
    .update({
      status: "credited",
      credit_amount: bonusAmount,
      approved_at: new Date().toISOString(),
      approved_by: user?.id ?? null,
    })
    .eq("id", referralId);

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to approve referrals." };
    }
    return { success: false, error: "Couldn't approve that referral. Please try again." };
  }

  // Issues the actual credit -- append-only ledger entry, same pattern
  // as every other financial record in this system.
  await supabase.from("ledger_entry").insert({
    tenant_id: referral.tenant_id,
    customer_id: referral.referrer_customer_id,
    entry_type: "referral_credit_earned",
    amount: bonusAmount,
    reference_type: "referral",
    reference_id: referral.id,
  });

  void logAuditEvent({
    tenantId: referral.tenant_id,
    action: "referral_approved",
    entityType: "referral",
    entityId: referralId,
    afterData: { creditAmount: bonusAmount },
    source: "staff_portal",
  });

  revalidatePath("/staff/referrals");
  return { success: true };
}
