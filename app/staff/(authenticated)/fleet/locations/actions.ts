"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type PickupLocation = {
  id: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  active: boolean;
};

export async function getLocations(): Promise<PickupLocation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("location")
    .select("id, name, address_line1, city, state, active")
    .order("name");
  return (data ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    addressLine1: l.address_line1,
    city: l.city,
    state: l.state,
    active: l.active,
  }));
}

// Permission-gated at the database level (manage_fleet, via
// location_manage_fleet_guard). Address is plain text for now --
// autocomplete is held pending the domain per explicit instruction.
export async function addLocation(
  name: string,
  addressLine1: string,
  city: string,
  state: string
): Promise<{ success: boolean; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Enter a location name." };

  const supabase = await createClient();
  const { data: tenantRow } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenantRow) return { success: false, error: "Something went wrong. Please try again." };

  const { error } = await supabase.from("location").insert({
    tenant_id: tenantRow.id,
    name: trimmed,
    address_line1: addressLine1.trim() || null,
    city: city.trim() || null,
    state: state.trim() || null,
  });

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to manage locations." };
    }
    return { success: false, error: "Couldn't add that location. Please try again." };
  }

  revalidatePath("/staff/fleet/locations");
  return { success: true };
}

export async function toggleLocationActive(locationId: string, active: boolean): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("location").update({ active }).eq("id", locationId);

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to manage locations." };
    }
    return { success: false, error: "Couldn't update that location." };
  }

  revalidatePath("/staff/fleet/locations");
  return { success: true };
}
