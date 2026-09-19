"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateInsuranceStatus(
  insurancePolicyId: string,
  status: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  // Permission-gated at the database level (migration 0030's
  // guard_insurance_verification trigger, requiring verify_insurance) --
  // same pattern as every other status change in this build.
  const { error } = await supabase
    .from("insurance_policy")
    .update({ verification_status: status, verified_at: new Date().toISOString() })
    .eq("id", insurancePolicyId);

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to change insurance status." };
    }
    return { success: false, error: "Couldn't update that. Please try again." };
  }

  revalidatePath("/staff/insurance");
  return { success: true };
}
