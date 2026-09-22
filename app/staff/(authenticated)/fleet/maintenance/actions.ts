"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit-log";

export type WorkOrder = {
  id: string;
  vehicleLabel: string;
  status: string;
  workType: string | null;
  cost: number | null;
  downtimeStart: string | null;
  downtimeEnd: string | null;
  notes: string | null;
};

export type VehicleOption = { id: string; label: string };

export async function getWorkOrders(): Promise<WorkOrder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("maintenance_work_order")
    .select("id, status, work_type, cost, downtime_start, downtime_end, notes, vehicle:vehicle_id(make, model, year, vin)")
    .order("downtime_start", { ascending: false, nullsFirst: false });

  return (data ?? []).map((w) => {
    const v = w.vehicle as any;
    return {
      id: w.id,
      vehicleLabel: v ? `${v.year} ${v.make} ${v.model} (${v.vin})` : "Unknown vehicle",
      status: w.status,
      workType: w.work_type,
      cost: w.cost,
      downtimeStart: w.downtime_start,
      downtimeEnd: w.downtime_end,
      notes: w.notes,
    };
  });
}

export async function getVehicleOptions(): Promise<VehicleOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("vehicle").select("id, make, model, year, vin").order("created_at");
  return (data ?? []).map((v) => ({ id: v.id, label: `${v.year} ${v.make} ${v.model} (${v.vin ?? "no VIN"})` }));
}

// Permission-gated at the database level (maintenance_work_order_fleet_guard,
// requiring manage_fleet -- migration 0045).
export async function createWorkOrder(
  vehicleId: string,
  workType: string,
  notes: string
): Promise<{ success: boolean; error?: string; warning?: string }> {
  if (!vehicleId) return { success: false, error: "Select a vehicle." };

  const supabase = await createClient();
  const { data: tenantRow } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenantRow) return { success: false, error: "Something went wrong. Please try again." };

  const { data: workOrder, error } = await supabase
    .from("maintenance_work_order")
    .insert({
      tenant_id: tenantRow.id,
      vehicle_id: vehicleId,
      status: "open",
      work_type: workType.trim() || null,
      notes: notes.trim() || null,
      downtime_start: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to log maintenance." };
    }
    return { success: false, error: "Couldn't create that work order. Please try again." };
  }

  // Vehicle goes into maintenance status -- matches the already-seeded
  // available/rented -> maintenance transitions (checked against
  // allowed_status_transition before relying on this). Deliberately
  // checked for failure here: 'reserved' (an upcoming pickup already
  // scheduled) is NOT a valid ->maintenance transition, and silently
  // ignoring that would leave a work order existing while the vehicle's
  // actual status doesn't reflect it at all.
  const { error: vehicleError } = await supabase.from("vehicle").update({ status: "maintenance" }).eq("id", vehicleId);
  if (vehicleError) {
    // The work order itself still exists and is valid -- this is a
    // heads-up, not a failure of the whole action.
    return {
      success: true,
      warning:
        "Work order created, but the vehicle's status couldn't be updated -- it may have an upcoming reservation. Resolve that first, or update the vehicle status manually on Fleet.",
    };
  }

  void logAuditEvent({
    tenantId: tenantRow.id,
    action: "maintenance_work_order_created",
    entityType: "maintenance_work_order",
    entityId: workOrder?.id ?? "",
    afterData: { vehicleId, workType },
    source: "staff_portal",
  });

  revalidatePath("/staff/fleet/maintenance");
  revalidatePath("/staff/fleet");
  return { success: true };
}

export async function completeWorkOrder(workOrderId: string, cost: number | null): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: workOrder } = await supabase.from("maintenance_work_order").select("id, tenant_id, vehicle_id").eq("id", workOrderId).single();
  if (!workOrder) return { success: false, error: "Work order not found." };

  const { error } = await supabase
    .from("maintenance_work_order")
    .update({ status: "completed", downtime_end: new Date().toISOString(), cost })
    .eq("id", workOrderId);

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to update maintenance." };
    }
    return { success: false, error: "Couldn't update that work order." };
  }

  // Free the vehicle back to available -- matches the already-seeded
  // maintenance -> available transition.
  await supabase.from("vehicle").update({ status: "available" }).eq("id", workOrder.vehicle_id);

  void logAuditEvent({
    tenantId: workOrder.tenant_id,
    action: "maintenance_work_order_completed",
    entityType: "maintenance_work_order",
    entityId: workOrderId,
    afterData: { cost },
    source: "staff_portal",
  });

  revalidatePath("/staff/fleet/maintenance");
  revalidatePath("/staff/fleet");
  return { success: true };
}
