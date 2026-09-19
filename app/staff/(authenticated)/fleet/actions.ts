"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type NewVehicleInput = {
  categoryId: string;
  vin: string;
  make: string;
  model: string;
  year: string;
  plate: string;
  mileage: string;
};

export async function createVehicle(input: NewVehicleInput): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: tenant } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenant) return { success: false, error: "Something went wrong. Please try again." };

  // This INSERT is permission-gated at the database level (migration 0021's
  // guard_manage_fleet trigger, requiring the manage_fleet permission) --
  // same pattern as application decisions. The UI doesn't duplicate that
  // check; it just reflects whatever the database actually decides.
  const { error } = await supabase.from("vehicle").insert({
    tenant_id: tenant.id,
    category_id: input.categoryId,
    vin: input.vin.trim() || null,
    make: input.make.trim() || null,
    model: input.model.trim() || null,
    year: input.year ? parseInt(input.year, 10) : null,
    plate: input.plate.trim() || null,
    mileage: input.mileage ? parseInt(input.mileage, 10) : 0,
    status: "acquired",
  });

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to add vehicles." };
    }
    if (error.message?.toLowerCase().includes("uq_vehicle_tenant_vin")) {
      return { success: false, error: "A vehicle with that VIN already exists." };
    }
    return { success: false, error: "Couldn't add that vehicle. Please try again." };
  }

  revalidatePath("/staff/fleet");
  return { success: true };
}

export async function updateVehicleStatus(
  vehicleId: string,
  status: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  // Two independent database-level checks run on this single UPDATE:
  // permission (manage_fleet, migration 0021) AND state-machine validity
  // (migration 0018's enforce_status_transition). Either can reject it --
  // the error message below is what actually happened, not a guess.
  const { error } = await supabase.from("vehicle").update({ status }).eq("id", vehicleId);

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to change vehicle status." };
    }
    if (error.message?.toLowerCase().includes("not an allowed state transition")) {
      return { success: false, error: `That status change isn't allowed from the vehicle's current status.` };
    }
    return { success: false, error: "Couldn't update that vehicle. Please try again." };
  }

  revalidatePath("/staff/fleet");
  return { success: true };
}
