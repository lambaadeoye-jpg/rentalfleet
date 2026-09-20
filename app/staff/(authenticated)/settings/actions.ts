"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function getMarketingSettings(): Promise<{ googleReviewUrl: string; facebookAdUrl: string }> {
  const supabase = await createClient();
  const { data } = await supabase.from("tenant_setting").select("key, value").in("key", ["google_review_url", "facebook_ad_url"]);

  const map = Object.fromEntries((data ?? []).map((s) => [s.key, s.value ?? ""]));
  return {
    googleReviewUrl: map.google_review_url ?? "",
    facebookAdUrl: map.facebook_ad_url ?? "",
  };
}

// Permission-gated at the database level (migration 0039's
// tenant_setting_permission_guard, requiring manage_marketing_settings).
export async function saveMarketingSettings(
  googleReviewUrl: string,
  facebookAdUrl: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: tenantRow } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenantRow) return { success: false, error: "Something went wrong. Please try again." };

  const rows = [
    { tenant_id: tenantRow.id, key: "google_review_url", value: googleReviewUrl },
    { tenant_id: tenantRow.id, key: "facebook_ad_url", value: facebookAdUrl },
  ];

  const { error } = await supabase.from("tenant_setting").upsert(rows, { onConflict: "tenant_id,key" });

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to change marketing settings." };
    }
    return { success: false, error: "Couldn't save. Please try again." };
  }

  revalidatePath("/staff/settings");
  return { success: true };
}
