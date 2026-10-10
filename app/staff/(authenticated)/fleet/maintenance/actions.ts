"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit-log";
import { currentRoleName, currentUser, isOfficeRole } from "@/lib/staff-role";
import { APPROVAL_LIMIT_KEY, parseCost, parseLimit } from "@/lib/maintenance";

export type WorkOrder = {
  id: string;
  vehicleLabel: string;
  status: string;
  workType: string | null;
  cost: number | null;
  downtimeStart: string | null;
  downtimeEnd: string | null;
  notes: string | null;
  performedBy: string | null;
  shopName: string | null;
  paymentArrangement: string | null;
  assignedRunnerId: string | null;
  settledAt: string | null;
  receiptUrls: string[];
};

export type VehicleOption = { id: string; label: string };

export async function getWorkOrders(): Promise<WorkOrder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("maintenance_work_order")
    .select("id, status, work_type, cost, downtime_start, downtime_end, notes, performed_by, shop_name, payment_arrangement, assigned_runner_id, settled_at, receipt_keys, vehicle:vehicle_id(make, model, year, vin)")
    .order("downtime_start", { ascending: false, nullsFirst: false });

  // Waiting-for-approval jobs first, then the rest newest first.
  const rows = [...(data ?? [])].sort((a: any, b: any) => Number(b.status === "pending_approval") - Number(a.status === "pending_approval"));

  // One batched call for every receipt link instead of one per job.
  const keys = rows.flatMap((w: any) => (w.receipt_keys ?? []) as string[]);
  const urlByKey = new Map<string, string>();
  if (keys.length > 0) {
    const { data: urls } = await supabase.storage.from("maintenance-receipts").createSignedUrls(keys, 600);
    for (const u of urls ?? []) if (u.path && u.signedUrl) urlByKey.set(u.path, u.signedUrl);
  }

  return rows.map((w: any) => {
    const v = w.vehicle as any;
    return {
      performedBy: w.performed_by ?? null,
      shopName: w.shop_name ?? null,
      paymentArrangement: w.payment_arrangement ?? null,
      assignedRunnerId: w.assigned_runner_id ?? null,
      settledAt: w.settled_at ?? null,
      receiptUrls: ((w.receipt_keys ?? []) as string[]).map((k) => urlByKey.get(k)).filter(Boolean) as string[],
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
  if (!vehicleId || !UUID_RE.test(vehicleId)) return { success: false, error: "Select a vehicle." };

  const supabase = await createClient();
  const { data: tenantRow } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenantRow) return { success: false, error: "Something went wrong. Please try again." };

  const { data: car } = await supabase.from("vehicle").select("status").eq("id", vehicleId).maybeSingle();
  if (!car) return { success: false, error: "Vehicle not found." };
  if (car.status === "rented") return { success: false, error: "That car is out on a rental. End or swap the rental first, then log the work." };
  if (car.status === "sold" || car.status === "decommissioned") return { success: false, error: "That car is no longer in the fleet." };

  const { data: workOrder, error } = await supabase
    .from("maintenance_work_order")
    .insert({
      tenant_id: tenantRow.id,
      vehicle_id: vehicleId,
      status: "open",
      work_type: workType.trim().slice(0, 120) || null,
      notes: notes.trim().slice(0, 2000) || null,
      downtime_start: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don’t have permission to log maintenance." };
    }
    return { success: false, error: "Couldn’t create that work order. Please try again." };
  }

  await logAuditEvent({
    tenantId: tenantRow.id,
    action: "maintenance_work_order_created",
    entityType: "maintenance_work_order",
    entityId: workOrder?.id ?? vehicleId,
    afterData: { vehicleId, workType },
    source: "staff_portal",
  });

  // Vehicle goes into maintenance status -- matches the already-seeded
  // available/rented -> maintenance transitions (checked against
  // allowed_status_transition before relying on this). Deliberately
  // checked for failure here: 'reserved' (an upcoming pickup already
  // scheduled) is NOT a valid ->maintenance transition, and silently
  // ignoring that would leave a work order existing while the vehicle’s
  // actual status doesn’t reflect it at all.
  const { error: vehicleError } = await supabase.from("vehicle").update({ status: "maintenance" }).eq("id", vehicleId);
  if (vehicleError) {
    // The work order itself still exists and is valid -- this is a
    // heads-up, not a failure of the whole action.
    return {
      success: true,
      warning:
        "Work order created, but the vehicle’s status couldn’t be updated -- it may have an upcoming reservation. Resolve that first, or update the vehicle status manually on Fleet.",
    };
  }

  revalidatePath("/staff/fleet/maintenance");
  revalidatePath("/staff/fleet");
  return { success: true };
}

export async function completeWorkOrder(workOrderId: string, cost: number | null): Promise<{ success: boolean; error?: string }> {
  if (!UUID_RE.test(workOrderId)) return { success: false, error: "Something went wrong. Please try again." };
  if (cost != null && !(Number.isFinite(cost) && cost >= 0 && cost <= 100000)) return { success: false, error: "Enter a cost between $0 and $100,000." };
  const supabase = await createClient();

  const { data: workOrder } = await supabase.from("maintenance_work_order").select("id, tenant_id, vehicle_id, status").eq("id", workOrderId).single();
  if (!workOrder) return { success: false, error: "Work order not found." };
  if (workOrder.status === "completed") return { success: false, error: "That job is already completed." };

  // Only an unfinished job can be completed, and only once (a double click must not run this twice).
  const { data: done, error } = await supabase
    .from("maintenance_work_order")
    .update({ status: "completed", downtime_end: new Date().toISOString(), cost })
    .eq("id", workOrderId)
    .in("status", ["open", "pending_approval"])
    .select("id");

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don’t have permission to update maintenance." };
    }
    return { success: false, error: "Couldn’t update that work order." };
  }
  if (!done || done.length === 0) return { success: false, error: "That job was already handled. Refresh the page." };

  // Free the car only if no other job still has it, and only if it is actually in maintenance.
  const { count: stillOpen } = await supabase.from("maintenance_work_order").select("id", { count: "exact", head: true }).eq("vehicle_id", workOrder.vehicle_id).in("status", ["open", "pending_approval"]);
  let warning: string | undefined;
  if ((stillOpen ?? 0) === 0) {
    const { error: freeError } = await supabase.from("vehicle").update({ status: "available" }).eq("id", workOrder.vehicle_id).eq("status", "maintenance");
    if (freeError) warning = "The job is completed, but the car’s status couldn’t be changed. Update it on Fleet.";
  }

  await logAuditEvent({
    tenantId: workOrder.tenant_id,
    action: "maintenance_work_order_completed",
    entityType: "maintenance_work_order",
    entityId: workOrderId,
    afterData: { cost },
    source: "staff_portal",
  });

  revalidatePath("/staff/fleet/maintenance");
  revalidatePath("/staff/fleet");
  return warning ? { success: true, error: warning } : { success: true };
}


// ---------------------------------------------------------------------------
// Office-only controls for jobs runners start: approve, send back, mark paid,
// assign a runner, and set the spending limit.
// ---------------------------------------------------------------------------
type Result = { success: boolean; error?: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function adminOnly() {
  const supabase = await createClient();
  const me = await currentUser(supabase);
  return me?.role === "admin" ? { supabase, me } : null;
}

/** Day-to-day dispatch: the manager can do this too. Spending decisions stay with the admin. */
async function officeOnly() {
  const supabase = await createClient();
  const me = await currentUser(supabase);
  return isOfficeRole(me?.role) ? { supabase, me } : null;
}

export async function getMaintenanceOffice(): Promise<{ limit: number; runners: { id: string; name: string }[] }> {
  const supabase = await createClient();
  const [{ data: setting }, { data: members }] = await Promise.all([
    supabase.from("tenant_setting").select("value").eq("key", APPROVAL_LIMIT_KEY).maybeSingle(),
    supabase.from("membership").select("user_id, role:role_id(name), user_profile:user_id(full_name, email)"),
  ]);
  return {
    limit: parseLimit(setting?.value ?? null),
    runners: (members ?? [])
      .filter((m: any) => m.role?.name === "field_staff")
      .map((m: any) => ({ id: m.user_id as string, name: (m.user_profile?.full_name || m.user_profile?.email || "Runner") as string })),
  };
}

export async function approveWorkOrder(workOrderId: string): Promise<Result> {
  if (!UUID_RE.test(workOrderId)) return { success: false, error: "Something went wrong. Please try again." };
  const ctx = await adminOnly();
  if (!ctx) return { success: false, error: "Only an admin can approve this." };
  const { supabase, me } = ctx;

  const { data: w } = await supabase.from("maintenance_work_order").select("id, tenant_id, vehicle_id, status, cost").eq("id", workOrderId).maybeSingle();
  if (!w) return { success: false, error: "Work order not found." };
  if (w.status !== "pending_approval") return { success: false, error: "This one isn’t waiting for approval." };

  const now = new Date().toISOString();
  const { data: claimed, error } = await supabase.from("maintenance_work_order").update({ status: "completed", approved_at: now, approved_by: me.id, downtime_end: now }).eq("id", workOrderId).eq("status", "pending_approval").select("id");
  if (error) return { success: false, error: "Couldn’t approve that. Please try again." };
  if (!claimed || claimed.length === 0) return { success: false, error: "That job was already handled. Refresh the page." };

  // Free the car only if no other job still has it, and only if it is actually in maintenance.
  const { count: stillOpen } = await supabase.from("maintenance_work_order").select("id", { count: "exact", head: true }).eq("vehicle_id", w.vehicle_id).in("status", ["open", "pending_approval"]);
  if ((stillOpen ?? 0) === 0) await supabase.from("vehicle").update({ status: "available" }).eq("id", w.vehicle_id).eq("status", "maintenance");

  await logAuditEvent({ tenantId: w.tenant_id, action: "maintenance_job_approved", entityType: "maintenance_work_order", entityId: workOrderId, afterData: { cost: w.cost }, source: "staff_portal" });
  revalidatePath("/staff/fleet/maintenance");
  revalidatePath("/staff/fleet");
  return { success: true };
}

/** Back to the runner to fix (receipt, cost). The car stays out of service. */
export async function sendBackWorkOrder(workOrderId: string): Promise<Result> {
  if (!UUID_RE.test(workOrderId)) return { success: false, error: "Something went wrong. Please try again." };
  const ctx = await officeOnly();
  if (!ctx) return { success: false, error: "Only the office can do this." };
  const { error } = await ctx.supabase.from("maintenance_work_order").update({ status: "open", submitted_at: null }).eq("id", workOrderId).eq("status", "pending_approval");
  if (error) return { success: false, error: "Couldn’t send that back. Please try again." };
  revalidatePath("/staff/fleet/maintenance");
  return { success: true };
}

export async function markWorkOrderSettled(workOrderId: string): Promise<Result> {
  if (!UUID_RE.test(workOrderId)) return { success: false, error: "Something went wrong. Please try again." };
  const ctx = await adminOnly();
  if (!ctx) return { success: false, error: "Only an admin can do this." };
  const { error } = await ctx.supabase.from("maintenance_work_order").update({ settled_at: new Date().toISOString() }).eq("id", workOrderId).is("settled_at", null);
  if (error) return { success: false, error: "Couldn’t save that. Please try again." };
  revalidatePath("/staff/fleet/maintenance");
  return { success: true };
}

export async function assignWorkOrderRunner(workOrderId: string, runnerId: string | null): Promise<Result> {
  if (!UUID_RE.test(workOrderId) || (runnerId !== null && !UUID_RE.test(runnerId))) return { success: false, error: "Something went wrong. Please try again." };
  const ctx = await officeOnly();
  if (!ctx) return { success: false, error: "Only the office can do this." };
  if (runnerId) {
    const { data: m } = await ctx.supabase.from("membership").select("role:role_id(name)").eq("user_id", runnerId).maybeSingle();
    if ((m?.role as any)?.name !== "field_staff") return { success: false, error: "That person isn’t a field runner." };
  }
  const { error } = await ctx.supabase.from("maintenance_work_order").update({ assigned_runner_id: runnerId }).eq("id", workOrderId);
  if (error) return { success: false, error: "Couldn’t save that. Please try again." };
  revalidatePath("/staff/fleet/maintenance");
  return { success: true };
}

export async function setApprovalLimit(text: string): Promise<Result> {
  const amount = parseCost(text);
  if (amount === null) return { success: false, error: "Enter a dollar amount, like 150." };
  const ctx = await adminOnly();
  if (!ctx) return { success: false, error: "Only an admin can change the limit." };
  const { data: tenant } = await ctx.supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenant) return { success: false, error: "Something went wrong. Please try again." };
  const { error } = await ctx.supabase.from("tenant_setting").upsert({ tenant_id: tenant.id, key: APPROVAL_LIMIT_KEY, value: String(amount), updated_at: new Date().toISOString() }, { onConflict: "tenant_id,key" });
  if (error) return { success: false, error: "Couldn’t save that. Please try again." };
  revalidatePath("/staff/fleet/maintenance");
  return { success: true };
}
