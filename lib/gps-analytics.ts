// Numbers behind the Fleet tracking charts. Pure functions, unit tested; no devices or events just gives empty results.
// Miles come from trips: the odometer at trip end minus the odometer at the trip start before it, for the same car.
// Plain position pings are not used, because they are pruned after 30 days and would make long ranges wrong.

import { isoDay, num, round2, weekStart, weekStarts } from "./analytics";

export type TripEvent = { vehicle_id: string; event_type: string; occurred_at: string; mileage: unknown };
export type AlertRow = { alert_type: string; created_at: string };
export type DeviceRow = { vehicle_id: string; active: boolean; last_seen_at: string | null };

export const MAX_TRIP_MILES = 500; // anything larger is a bad odometer reading, not a trip

export type Trip = { vehicleId: string; endedAt: string; miles: number | null };

/** Pairs trip_start and trip_end per car. A trip with a missing or implausible odometer still counts, with miles null. */
export function pairTrips(events: TripEvent[]): Trip[] {
  const byCar = new Map<string, TripEvent[]>();
  for (const e of events) {
    if (e.event_type !== "trip_start" && e.event_type !== "trip_end") continue;
    byCar.set(e.vehicle_id, [...(byCar.get(e.vehicle_id) ?? []), e]);
  }
  const trips: Trip[] = [];
  for (const [vehicleId, list] of byCar) {
    list.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    let start: number | null | undefined; // undefined = no open trip
    for (const e of list) {
      if (e.event_type === "trip_start") {
        start = e.mileage === null || e.mileage === undefined ? null : num(e.mileage);
      } else {
        const end = e.mileage === null || e.mileage === undefined ? null : num(e.mileage);
        const miles = start !== undefined && start !== null && end !== null && end >= start && end - start <= MAX_TRIP_MILES ? end - start : null;
        trips.push({ vehicleId, endedAt: e.occurred_at, miles });
        start = undefined;
      }
    }
  }
  return trips;
}

const inRange = (iso: string, from: Date, to: Date) => {
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
};

export type TrackingWeek = { start: string; miles: number; trips: number };

export function weeklyTracking(trips: Trip[], from: Date, to: Date): TrackingWeek[] {
  const weeks = new Map<string, TrackingWeek>(weekStarts(from, to).map((s) => [s, { start: s, miles: 0, trips: 0 }]));
  for (const t of trips) {
    if (!inRange(t.endedAt, from, to)) continue;
    const w = weeks.get(isoDay(weekStart(new Date(t.endedAt))));
    if (!w) continue;
    w.trips += 1;
    w.miles += t.miles ?? 0;
  }
  return [...weeks.values()].map((w) => ({ ...w, miles: round2(w.miles) }));
}

/** Miles and trips per car in the range, most miles first. */
export function milesByCar(trips: Trip[], names: Map<string, string>, from: Date, to: Date): { id: string; label: string; miles: number; trips: number }[] {
  const acc = new Map<string, { miles: number; trips: number }>();
  for (const t of trips) {
    if (!inRange(t.endedAt, from, to)) continue;
    const a = acc.get(t.vehicleId) ?? { miles: 0, trips: 0 };
    a.trips += 1;
    a.miles += t.miles ?? 0;
    acc.set(t.vehicleId, a);
  }
  return [...acc.entries()]
    .map(([id, a]) => ({ id, label: names.get(id) ?? "Vehicle", miles: round2(a.miles), trips: a.trips }))
    .sort((a, b) => b.miles - a.miles || a.label.localeCompare(b.label));
}

export function alertsByType(alerts: AlertRow[], from: Date, to: Date): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const a of alerts) {
    if (!inRange(a.created_at, from, to)) continue;
    const label = (a.alert_type || "other").replace(/_/g, " ");
    m.set(label, (m.get(label) ?? 0) + 1);
  }
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** How many cars have an active tracker that reported within the last 24 hours. */
export function trackerCoverage(devices: DeviceRow[], fleetSize: number, now: Date = new Date()): { reporting: number; withTracker: number; fleetSize: number } {
  const recent = now.getTime() - 24 * 60 * 60 * 1000;
  const withTracker = new Set<string>();
  const reporting = new Set<string>();
  for (const d of devices) {
    if (!d.active) continue;
    withTracker.add(d.vehicle_id);
    if (d.last_seen_at && new Date(d.last_seen_at).getTime() >= recent) reporting.add(d.vehicle_id);
  }
  return { reporting: reporting.size, withTracker: withTracker.size, fleetSize };
}
