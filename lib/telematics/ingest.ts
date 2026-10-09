import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrackerReading } from "./types";
import { sortByTime, summarizeForCache, thinForStorage } from "./summarize";

export type NewAlert = {
  vehicleId: string;
  tenantId: string;
  alertType: string;
  severity: string;
  occurredAt: string;
  plate: string | null;
  vehicleName: string;
};

export type IngestResult = {
  received: number;
  stored: number;
  unknownDevices: string[];
  newAlerts: NewAlert[];
};

type DeviceRow = {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  external_device_id: string;
  last_seen_at: string | null;
  last_position_at: string | null;
};

/**
 * Saves readings from a tracker. Needs a service-role client: the sender is a
 * webhook, not a signed-in user. Readings from devices we don't know are
 * dropped and reported back, never an error, so a provider doesn't disable
 * the webhook over one stray device.
 */
export async function ingestReadings(db: SupabaseClient, provider: string, readings: TrackerReading[]): Promise<IngestResult> {
  const result: IngestResult = { received: readings.length, stored: 0, unknownDevices: [], newAlerts: [] };
  if (readings.length === 0) return result;

  const wantedIds = [...new Set(readings.map((r) => r.externalDeviceId))];
  const { data: devices, error } = await db
    .from("telematics_device")
    .select("id, tenant_id, vehicle_id, external_device_id, last_seen_at, last_position_at")
    .eq("provider", provider)
    .eq("active", true)
    .in("external_device_id", wantedIds);
  if (error) throw new Error(`device lookup failed: ${error.message}`);

  const byExternal = new Map<string, DeviceRow[]>();
  for (const d of (devices ?? []) as DeviceRow[]) {
    byExternal.set(d.external_device_id, [...(byExternal.get(d.external_device_id) ?? []), d]);
  }
  result.unknownDevices = wantedIds.filter((id) => !byExternal.has(id));

  for (const [externalId, rows] of byExternal) {
    const mine = sortByTime(readings.filter((r) => r.externalDeviceId === externalId));
    for (const device of rows) {
      // 1. History rows (thinned, duplicates ignored).
      const toStore = thinForStorage(mine).map((r) => ({
        tenant_id: device.tenant_id,
        vehicle_id: device.vehicle_id,
        device_id: device.id,
        event_type: r.kind,
        occurred_at: r.occurredAt,
        latitude: r.latitude ?? null,
        longitude: r.longitude ?? null,
        mileage: r.odometerMiles !== undefined ? Math.round(r.odometerMiles) : null,
        speed: r.speedMph ?? null,
        battery: r.batteryVolts ?? null,
        payload: { raw: r.raw, alert_type: r.alertType ?? null },
      }));
      if (toStore.length > 0) {
        const { data: inserted, error: eventError } = await db
          .from("telematics_event")
          .upsert(toStore, { onConflict: "device_id,event_type,occurred_at", ignoreDuplicates: true })
          .select("id");
        if (eventError) throw new Error(`event save failed: ${eventError.message}`);
        result.stored += inserted?.length ?? 0;
      }

      // 2. Latest-state cache (from ALL readings, not just the thinned ones).
      const cache = summarizeForCache(mine, device);
      if (Object.keys(cache).length > 0) {
        const { error: cacheError } = await db.from("telematics_device").update(cache).eq("id", device.id);
        if (cacheError) throw new Error(`device update failed: ${cacheError.message}`);
      }

      // 3. Alerts: one open alert per type per vehicle.
      const wanted = new Map<string, TrackerReading>();
      for (const r of mine) if (r.alertType && !wanted.has(r.alertType)) wanted.set(r.alertType, r);
      if (wanted.size > 0) {
        const { data: open } = await db
          .from("telematics_alert")
          .select("alert_type")
          .eq("vehicle_id", device.vehicle_id)
          .eq("status", "open")
          .in("alert_type", [...wanted.keys()]);
        const alreadyOpen = new Set((open ?? []).map((a: { alert_type: string }) => a.alert_type));
        const fresh = [...wanted.values()].filter((r) => !alreadyOpen.has(r.alertType as string));
        if (fresh.length > 0) {
          const { error: alertError } = await db.from("telematics_alert").insert(
            fresh.map((r) => ({
              tenant_id: device.tenant_id,
              vehicle_id: device.vehicle_id,
              alert_type: r.alertType,
              severity: r.severity ?? "warning",
            }))
          );
          if (alertError) throw new Error(`alert save failed: ${alertError.message}`);
          const { data: vehicle } = await db.from("vehicle").select("plate, year, make, model").eq("id", device.vehicle_id).maybeSingle();
          const name = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "Vehicle";
          for (const r of fresh) {
            result.newAlerts.push({
              vehicleId: device.vehicle_id,
              tenantId: device.tenant_id,
              alertType: r.alertType as string,
              severity: r.severity ?? "warning",
              occurredAt: r.occurredAt,
              plate: vehicle?.plate ?? null,
              vehicleName: name,
            });
          }
        }
      }
    }
  }
  return result;
}
