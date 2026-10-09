"use server";

import { createClient } from "@/lib/supabase/server";
import { loadRuleValues } from "@/lib/handover-server";
import { serviceDue, type ServiceState } from "@/lib/maintenance";

export type ServiceDueRow = { vehicleId: string; label: string; state: ServiceState; daysLeft: number; dueAt: string; lastServiceAt: string | null };

/** Cars that are overdue or due soon for their regular service, most overdue first. Cars in the shop or sold are left out. */
export async function getServiceDue(): Promise<{ rows: ServiceDueRow[]; intervalDays: number }> {
  const supabase = await createClient();
  const rules = await loadRuleValues(supabase);
  const [{ data: cars }, { data: jobs }] = await Promise.all([
    supabase.from("vehicle").select("id, year, make, model, plate, status, created_at").in("status", ["ready", "available", "reserved", "rented"]),
    supabase.from("maintenance_work_order").select("vehicle_id, downtime_end").eq("status", "completed").not("downtime_end", "is", null),
  ]);
  const last = new Map<string, string>();
  for (const j of jobs ?? []) {
    const cur = last.get(j.vehicle_id);
    if (!cur || Date.parse(j.downtime_end) > Date.parse(cur)) last.set(j.vehicle_id, j.downtime_end);
  }
  const now = new Date();
  const rows: ServiceDueRow[] = (cars ?? [])
    .map((v: any) => {
      const d = serviceDue({ lastServiceAt: last.get(v.id) ?? null, baselineAt: v.created_at, now, intervalDays: rules.maintenanceDays });
      return {
        vehicleId: v.id,
        label: `${[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}${v.plate ? ` · ${v.plate}` : ""}`,
        state: d.state, daysLeft: d.daysLeft, dueAt: d.dueAt, lastServiceAt: last.get(v.id) ?? null,
      };
    })
    .filter((r) => r.state !== "ok")
    .sort((a, b) => a.daysLeft - b.daysLeft);
  return { rows, intervalDays: rules.maintenanceDays };
}
