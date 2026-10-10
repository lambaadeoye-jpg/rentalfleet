"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseOfferDay, MAX_OFFER_DAY } from "@/lib/weekly-switch";

// The day of the rental on which renters are offered the weekly plan. One number for the whole business (not per
// renter), so two settings can be compared over time, for example 3 days against 7 days. Each switch records the
// day that was in force (plan_change.offer_day). Changing it applies to texts for rentals that start afterwards
// and at once to the portal offer; texts already waiting keep their original day.

export async function getWeeklyOfferDay(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.from("tenant_setting").select("value").eq("key", "weekly_offer_day").maybeSingle();
  return parseOfferDay(data?.value);
}

export async function saveWeeklyOfferDay(day: number): Promise<{ success: boolean; error?: string }> {
  if (!Number.isInteger(day) || day < 1 || day > MAX_OFFER_DAY) return { success: false, error: `Enter a whole number of days from 1 to ${MAX_OFFER_DAY}.` };
  const supabase = await createClient();
  const { data: tenantRow } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenantRow) return { success: false, error: "Something went wrong. Please try again." };
  const { error } = await supabase.from("tenant_setting").upsert(
    { tenant_id: tenantRow.id, key: "weekly_offer_day", value: String(day), updated_at: new Date().toISOString() },
    { onConflict: "tenant_id,key" }
  );
  if (error) {
    if (error.message?.toLowerCase().includes("permission")) return { success: false, error: "You don’t have permission to change this setting." };
    return { success: false, error: "Couldn’t save. Please try again." };
  }
  revalidatePath("/staff/settings");
  return { success: true };
}
