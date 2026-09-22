"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit-log";

export type IncidentRecord = {
  id: string;
  vehicleLabel: string | null;
  customerName: string | null;
  incidentType: string;
  status: string;
  occurredAt: string | null;
  description: string | null;
};

export type VehicleOption = { id: string; label: string };
export type CustomerOption = { id: string; label: string };

export async function getIncidents(): Promise<IncidentRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("incident")
    .select("id, incident_type, status, occurred_at, description, vehicle:vehicle_id(make, model, year, vin), customer:customer_id(first_name, last_name)")
    .order("occurred_at", { ascending: false, nullsFirst: false });

  return (data ?? []).map((i) => {
    const v = i.vehicle as any;
    const c = i.customer as any;
    return {
      id: i.id,
      vehicleLabel: v ? `${v.year} ${v.make} ${v.model} (${v.vin})` : null,
      customerName: c ? `${c.first_name} ${c.last_name}` : null,
      incidentType: i.incident_type,
      status: i.status,
      occurredAt: i.occurred_at,
      description: i.description,
    };
  });
}

export async function getVehicleOptions(): Promise<VehicleOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("vehicle").select("id, make, model, year, vin").order("created_at");
  return (data ?? []).map((v) => ({ id: v.id, label: `${v.year} ${v.make} ${v.model} (${v.vin ?? "no VIN"})` }));
}

export async function getCustomerOptions(): Promise<CustomerOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("customer").select("id, first_name, last_name").order("created_at", { ascending: false }).limit(100);
  return (data ?? []).map((c) => ({ id: c.id, label: `${c.first_name} ${c.last_name}` }));
}

// Permission-gated at the database level (incident_fleet_guard, requiring
// manage_fleet -- migration 0045).
export async function logIncident(
  incidentType: string,
  vehicleId: string,
  customerId: string,
  description: string
): Promise<{ success: boolean; error?: string }> {
  if (!incidentType.trim()) return { success: false, error: "Describe the type of incident." };

  const supabase = await createClient();
  const { data: tenantRow } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenantRow) return { success: false, error: "Something went wrong. Please try again." };

  const { data: incident, error } = await supabase
    .from("incident")
    .insert({
      tenant_id: tenantRow.id,
      vehicle_id: vehicleId || null,
      customer_id: customerId || null,
      incident_type: incidentType.trim(),
      status: "open",
      occurred_at: new Date().toISOString(),
      description: description.trim() || null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to log incidents." };
    }
    return { success: false, error: "Couldn't log that incident. Please try again." };
  }

  void logAuditEvent({
    tenantId: tenantRow.id,
    action: "incident_logged",
    entityType: "incident",
    entityId: incident?.id ?? "",
    afterData: { incidentType, vehicleId: vehicleId || null, customerId: customerId || null },
    source: "staff_portal",
  });

  revalidatePath("/staff/fleet/incidents");
  return { success: true };
}

export async function resolveIncident(incidentId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: incident } = await supabase.from("incident").select("id, tenant_id").eq("id", incidentId).single();
  if (!incident) return { success: false, error: "Incident not found." };

  const { error } = await supabase.from("incident").update({ status: "resolved" }).eq("id", incidentId);

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to update incidents." };
    }
    return { success: false, error: "Couldn't resolve that incident." };
  }

  void logAuditEvent({
    tenantId: incident.tenant_id,
    action: "incident_resolved",
    entityType: "incident",
    entityId: incidentId,
    source: "staff_portal",
  });

  revalidatePath("/staff/fleet/incidents");
  return { success: true };
}
