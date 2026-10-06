"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateWeeklyRules, clampHoldMinutes, minutesOfDay, type WeeklyRuleInput } from "@/lib/pickup-slots";

// Staff controls for self-serve pickup booking (Phase 3A). The on/off switch
// and hold length live in tenant_setting (admin-only, guarded in the database);
// weekly hours per location are replaced atomically by set_location_pickup_hours
// (needs manage_fleet; row-level security applies).

export type LocationHours = {
  locationId: string;
  name: string;
  rules: WeeklyRuleInput[]; // always 7 entries, Sunday first
};

export type PickupScheduling = {
  enabled: boolean;
  holdMinutes: number;
  locations: LocationHours[];
};

const DEFAULT_RULE = { startTime: "10:00", endTime: "16:00", slotMinutes: 30, capacity: 1 };

function toHHMM(t: string | null | undefined): string {
  return (t ?? "").slice(0, 5);
}

export async function getPickupScheduling(): Promise<PickupScheduling> {
  const supabase = await createClient();
  const [{ data: settings }, { data: locs }, { data: rules }] = await Promise.all([
    supabase.from("tenant_setting").select("key, value").in("key", ["slot_picker_enabled", "slot_hold_minutes"]),
    supabase.from("location").select("id, name").eq("active", true).order("name"),
    supabase.from("pickup_slot_rule").select("location_id, weekday, start_time, end_time, slot_minutes, capacity, active").eq("active", true),
  ]);
  const map = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value ?? ""]));
  const holdRaw = Number(map.slot_hold_minutes);

  const locations: LocationHours[] = (locs ?? []).map((l) => {
    const mine = (rules ?? []).filter((r) => r.location_id === l.id);
    const hasAny = mine.length > 0;
    const week: WeeklyRuleInput[] = Array.from({ length: 7 }, (_, weekday) => {
      // The form edits one window per day; if a day somehow has several, show the earliest.
      const found = mine.filter((r) => r.weekday === weekday).sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))[0];
      if (found) {
        return { weekday, open: true, startTime: toHHMM(found.start_time), endTime: toHHMM(found.end_time), slotMinutes: found.slot_minutes, capacity: found.capacity };
      }
      // Never configured: suggest Mon-Fri; configured locations keep their closed days closed.
      return { weekday, open: !hasAny && weekday >= 1 && weekday <= 5, ...DEFAULT_RULE };
    });
    return { locationId: l.id, name: l.name, rules: week };
  });

  return {
    enabled: map.slot_picker_enabled === "on",
    holdMinutes: Number.isFinite(holdRaw) && holdRaw > 0 ? clampHoldMinutes(holdRaw) : 30,
    locations,
  };
}

export async function savePickupSettings(enabled: boolean, holdMinutes: number): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: tenantRow } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenantRow) return { success: false, error: "Something went wrong. Please try again." };

  const rows = [
    { tenant_id: tenantRow.id, key: "slot_picker_enabled", value: enabled ? "on" : "off" },
    { tenant_id: tenantRow.id, key: "slot_hold_minutes", value: String(clampHoldMinutes(holdMinutes)) },
  ];
  const { error } = await supabase.from("tenant_setting").upsert(rows, { onConflict: "tenant_id,key" });
  if (error) {
    if (error.message?.toLowerCase().includes("permission")) return { success: false, error: "You don't have permission to change this setting." };
    return { success: false, error: "Couldn't save. Please try again." };
  }
  revalidatePath("/staff/settings");
  return { success: true };
}

export async function saveLocationHours(locationId: string, week: WeeklyRuleInput[]): Promise<{ success: boolean; error?: string }> {
  if (!Array.isArray(week) || week.length > 7) return { success: false, error: "Something went wrong. Please try again." };
  const problem = validateWeeklyRules(week);
  if (problem) return { success: false, error: problem };

  const open = week.filter((d) => d.open);
  const payload = open.map((d) => ({
    weekday: d.weekday,
    start_time: d.startTime,
    end_time: d.endTime,
    slot_minutes: d.slotMinutes,
    capacity: d.capacity,
  }));
  // Defensive: validation already guarantees these parse.
  if (payload.some((p) => minutesOfDay(p.start_time) === null || minutesOfDay(p.end_time) === null)) {
    return { success: false, error: "Enter valid opening and closing times." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_location_pickup_hours", { p_location_id: locationId, p_rules: payload });
  if (error) {
    const m = error.message?.toLowerCase() ?? "";
    if (m.includes("permission")) return { success: false, error: "You don't have permission to change pickup hours." };
    if (m.includes("location_not_found")) return { success: false, error: "Location not found." };
    return { success: false, error: "Couldn't save. Please try again." };
  }
  revalidatePath("/staff/settings");
  return { success: true };
}
