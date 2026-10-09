import { createClient } from "@/lib/supabase/server";
import { trackerState, type TrackerState } from "@/lib/telematics/status";

export type TrackerInfo = {
  id: string;
  provider: string;
  externalId: string;
  nickname: string | null;
  lastSeenAt: string | null;
  lastPositionAt: string | null;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  ignition: boolean | null;
  odometer: number | null;
};

export type OpenAlert = { id: string; vehicleId: string; type: string; severity: string; createdAt: string };

export type TrackedVehicle = {
  vehicleId: string;
  name: string;
  plate: string | null;
  vehicleStatus: string;
  renter: string | null;
  tracker: TrackerInfo | null;
  alerts: OpenAlert[];
  state: TrackerState | "untracked";
};

/** Every vehicle still in the fleet, with its active tracker, open alerts and current renter. */
export async function loadTrackedVehicles(): Promise<{ vehicles: TrackedVehicle[]; alerts: OpenAlert[]; needsMigration: boolean }> {
  const supabase = await createClient();

  const [{ data: vehicleRows, error: vehicleError }, { data: alertRows }, { data: segmentRows }] = await Promise.all([
    supabase
      .from("vehicle")
      .select(
        "id, plate, year, make, model, status, telematics_device(id, provider, external_device_id, nickname, active, last_seen_at, last_position_at, last_latitude, last_longitude, last_speed, last_ignition, last_odometer)"
      )
      .not("status", "in", "(decommissioned,sold)")
      .order("created_at", { ascending: true }),
    supabase.from("telematics_alert").select("id, vehicle_id, alert_type, severity, created_at").eq("status", "open").order("created_at", { ascending: false }),
    // Active rentals with their cars and renters, the same way the Pickups page reads them.
    supabase.from("rental").select("id, customer:customer_id(first_name, last_name), rental_segment(vehicle_id, ends_at)").eq("status", "active"),
  ]);

  // The tracking columns arrive with migration 0092. Until it has run, say so instead of showing an empty fleet.
  if (vehicleError) return { vehicles: [], alerts: [], needsMigration: true };

  const alerts: OpenAlert[] = (alertRows ?? []).map((a: any) => ({
    id: a.id,
    vehicleId: a.vehicle_id,
    type: a.alert_type,
    severity: a.severity,
    createdAt: a.created_at,
  }));

  const renterByVehicle = new Map<string, string>();
  for (const r of (segmentRows ?? []) as any[]) {
    const c = r.customer;
    if (!c) continue;
    for (const seg of r.rental_segment ?? []) {
      if (!seg.ends_at) renterByVehicle.set(seg.vehicle_id, `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim());
    }
  }

  const vehicles: TrackedVehicle[] = (vehicleRows ?? []).map((v: any) => {
    const devices: any[] = v.telematics_device ?? [];
    // If a car has both a real tracker and a manual entry, the one heard from most recently wins.
    const active = devices.filter((x) => x.active);
    active.sort((x, y) => (Date.parse(y.last_seen_at ?? "") || 0) - (Date.parse(x.last_seen_at ?? "") || 0) || Number(x.provider === "manual") - Number(y.provider === "manual"));
    const d = active[0] ?? null;
    const myAlerts = alerts.filter((a) => a.vehicleId === v.id);
    const tracker: TrackerInfo | null = d
      ? {
          id: d.id,
          provider: d.provider,
          externalId: d.external_device_id,
          nickname: d.nickname,
          lastSeenAt: d.last_seen_at,
          lastPositionAt: d.last_position_at,
          latitude: d.last_latitude === null ? null : Number(d.last_latitude),
          longitude: d.last_longitude === null ? null : Number(d.last_longitude),
          speed: d.last_speed === null ? null : Number(d.last_speed),
          ignition: d.last_ignition,
          odometer: d.last_odometer === null ? null : Number(d.last_odometer),
        }
      : null;
    return {
      vehicleId: v.id,
      name: [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle",
      plate: v.plate,
      vehicleStatus: v.status,
      renter: renterByVehicle.get(v.id) ?? null,
      tracker,
      alerts: myAlerts,
      state: tracker
        ? trackerState({ lastSeenAt: tracker.lastSeenAt, hasOpenUnplugAlert: myAlerts.some((a) => a.type === "device_unplugged") })
        : "untracked",
    };
  });

  return { vehicles, alerts, needsMigration: false };
}
