"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type VehicleCategory = { id: string; name: string; description: string | null; active: boolean };

export async function getVehicleCategories(): Promise<VehicleCategory[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("vehicle_category").select("id, name, description, active").order("name");
  return data ?? [];
}

// Permission-gated at the database level (manage_fleet, via the existing
// vehicle_category_manage_fleet_guard trigger).
export async function addVehicleCategory(name: string, description: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Enter a category name." };

  const supabase = await createClient();
  const { data: tenantRow } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenantRow) return { success: false, error: "Something went wrong. Please try again." };

  const { error } = await supabase
    .from("vehicle_category")
    .insert({ tenant_id: tenantRow.id, name: trimmed, description: description.trim() || null });

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to manage vehicle categories." };
    }
    if (error.message?.toLowerCase().includes("duplicate") || error.message?.toLowerCase().includes("unique")) {
      return { success: false, error: "A category with that name already exists." };
    }
    return { success: false, error: "Couldn't add that category. Please try again." };
  }

  revalidatePath("/staff/fleet/categories");
  return { success: true };
}

export async function toggleVehicleCategoryActive(categoryId: string, active: boolean): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("vehicle_category").update({ active }).eq("id", categoryId);

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to manage vehicle categories." };
    }
    return { success: false, error: "Couldn't update that category." };
  }

  revalidatePath("/staff/fleet/categories");
  return { success: true };
}
