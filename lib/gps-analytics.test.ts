import { describe, expect, it } from "vitest";
import { alertsByType, milesByCar, pairTrips, trackerCoverage, weeklyTracking } from "./gps-analytics";

const ev = (vehicle_id: string, event_type: string, occurred_at: string, mileage: number | null) => ({ vehicle_id, event_type, occurred_at, mileage });
const FROM = new Date("2026-09-14T00:00:00Z"); // Monday
const TO = new Date("2026-09-28T00:00:00Z");

describe("pairTrips", () => {
  it("measures miles from trip start to trip end per car", () => {
    const t = pairTrips([
      ev("A", "trip_start", "2026-09-14T08:00:00Z", 1000), ev("A", "trip_end", "2026-09-14T09:00:00Z", 1025),
      ev("B", "trip_start", "2026-09-14T08:30:00Z", 500), ev("B", "trip_end", "2026-09-14T09:30:00Z", 512),
    ]);
    expect(t.map((x) => x.miles).sort()).toEqual([12, 25]);
  });
  it("counts a trip with no start or a bad odometer, but with unknown miles", () => {
    const t = pairTrips([
      ev("A", "trip_end", "2026-09-14T09:00:00Z", 1025), // no start
      ev("A", "trip_start", "2026-09-15T08:00:00Z", 1025), ev("A", "trip_end", "2026-09-15T09:00:00Z", 1010), // goes backwards
      ev("A", "trip_start", "2026-09-16T08:00:00Z", 1000), ev("A", "trip_end", "2026-09-16T09:00:00Z", 9000), // too long
    ]);
    expect(t).toHaveLength(3);
    expect(t.every((x) => x.miles === null)).toBe(true);
  });
  it("ignores other event types and handles empty input", () => {
    expect(pairTrips([ev("A", "position", "2026-09-14T08:00:00Z", 1)])).toEqual([]);
    expect(pairTrips([])).toEqual([]);
  });
  it("sorts events by time, and a second start replaces an unfinished one", () => {
    const t = pairTrips([
      ev("A", "trip_end", "2026-09-14T10:00:00Z", 1030), ev("A", "trip_start", "2026-09-14T08:00:00Z", 1000), ev("A", "trip_start", "2026-09-14T09:00:00Z", 1020),
    ]);
    expect(t).toHaveLength(1);
    expect(t[0].miles).toBe(10);
  });
});

describe("weekly and per-car totals", () => {
  const trips = pairTrips([
    ev("A", "trip_start", "2026-09-14T08:00:00Z", 1000), ev("A", "trip_end", "2026-09-14T09:00:00Z", 1020),
    ev("A", "trip_start", "2026-09-22T08:00:00Z", 1020), ev("A", "trip_end", "2026-09-22T09:00:00Z", 1070),
    ev("B", "trip_start", "2026-09-23T08:00:00Z", 10), ev("B", "trip_end", "2026-09-23T09:00:00Z", 15),
    ev("B", "trip_start", "2026-10-05T08:00:00Z", 15), ev("B", "trip_end", "2026-10-05T09:00:00Z", 99), // outside the range
  ]);
  it("groups by the Monday week of the trip end, including empty weeks", () => {
    expect(weeklyTracking(trips, FROM, TO)).toEqual([
      { start: "2026-09-14", miles: 20, trips: 1 },
      { start: "2026-09-21", miles: 55, trips: 2 },
    ]);
  });
  it("totals per car, most miles first, and falls back to a generic name", () => {
    const r = milesByCar(trips, new Map([["A", "Camry"]]), FROM, TO);
    expect(r).toEqual([{ id: "A", label: "Camry", miles: 70, trips: 2 }, { id: "B", label: "Vehicle", miles: 5, trips: 1 }]);
  });
  it("empty data gives zero weeks of zeros", () => {
    expect(weeklyTracking([], FROM, TO).every((w) => w.miles === 0 && w.trips === 0)).toBe(true);
    expect(milesByCar([], new Map(), FROM, TO)).toEqual([]);
  });
});

describe("alertsByType and trackerCoverage", () => {
  it("counts alerts in range by readable type", () => {
    const r = alertsByType([
      { alert_type: "low_battery", created_at: "2026-09-15T00:00:00Z" }, { alert_type: "low_battery", created_at: "2026-09-16T00:00:00Z" },
      { alert_type: "unplugged", created_at: "2026-09-17T00:00:00Z" }, { alert_type: "unplugged", created_at: "2026-08-01T00:00:00Z" },
    ], FROM, TO);
    expect(r).toEqual([{ label: "low battery", count: 2 }, { label: "unplugged", count: 1 }]);
  });
  it("counts cars with an active tracker that reported in the last 24 hours", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const c = trackerCoverage([
      { vehicle_id: "A", active: true, last_seen_at: "2026-10-10T11:00:00Z" },
      { vehicle_id: "B", active: true, last_seen_at: "2026-10-08T11:00:00Z" },
      { vehicle_id: "C", active: false, last_seen_at: "2026-10-10T11:00:00Z" },
      { vehicle_id: "A", active: true, last_seen_at: null },
    ], 4, now);
    expect(c).toEqual({ reporting: 1, withTracker: 2, fleetSize: 4 });
  });
});
