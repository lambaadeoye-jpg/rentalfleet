"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { monthStart } from "@/lib/ad-spend";
import { isAdmin } from "./data";

/** Admin only. One row per channel per month; saving again for the same channel and month replaces it. */
export async function saveAdSpend(input: { month: string; source: string; amount: string }): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  if (!(await isAdmin(supabase))) return { success: false, error: "Only the owner can change ad spend." };

  const month = monthStart(input.month);
  const source = input.source.trim().toLowerCase().replace(/\s+/g, "_");
  const amountText = input.amount.trim().replace(/[$,]/g, "");
  if (!month) return { success: false, error: "Pick a month." };
  if (!/^[a-z0-9_]{1,60}$/.test(source)) return { success: false, error: "Channel can use letters, numbers and underscores, for example meta_ads." };
  if (!/^\d+(\.\d{1,2})?$/.test(amountText) || Number(amountText) > 1_000_000) return { success: false, error: "Enter the amount as a plain number like 250 or 1200.50." };

  const { data: tenant } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenant) return { success: false, error: "Something went wrong. Please try again." };

  const { error } = await supabase
    .from("ad_spend")
    .upsert({ tenant_id: tenant.id, month, source, amount: Number(amountText), updated_at: new Date().toISOString() }, { onConflict: "tenant_id,month,source" });
  if (error) return { success: false, error: "Couldn’t save. Please try again." };

  revalidatePath("/staff/business");
  return { success: true };
}

export async function deleteAdSpend(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  if (!(await isAdmin(supabase))) return { success: false, error: "Only the owner can change ad spend." };
  const { error } = await supabase.from("ad_spend").delete().eq("id", id);
  if (error) return { success: false, error: "Couldn’t delete. Please try again." };
  revalidatePath("/staff/business");
  return { success: true };
}
