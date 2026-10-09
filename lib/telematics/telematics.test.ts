import { describe, expect, it } from "vitest";
import { adapterFor, bouncieAdapter, genericAdapter } from "./adapters";
import { summarizeForCache, thinForStorage } from "./summarize";
import { alertLabel, parseCoordinates, timeAgo, trackerState } from "./status";
import type { TrackerReading } from "./types";

const IMEI = "123456789012345";

describe("bouncieAdapter (payloads from docs.bouncie.dev examples)", () => {
  it("turns tripData points into positions", () => {
    const readings = bouncieAdapter.parse({
      eventType: "tripData",
      imei: IMEI,
      vin: "1HGBIQOJXMN109186",
      transactionId: "t1",
      data: [
        { timestamp: "2026-01-01T10:01:00.000Z", speed: 45, gps: { lat: 32.7767432, lon: -96.7970123, heading: 135 }, fuelLevelInput: 75.5 },
        { timestamp: "2026-01-01T10:01:05.000Z", speed: 47, gps: { lat: 32.7768, lon: -96.797, heading: 135 } },
      ],
    });
    expect(readings).toHaveLength(2);
    expect(readings[0]).toMatchObject({ externalDeviceId: IMEI, kind: "position", latitude: 32.7767432, longitude: -96.7970123, speedMph: 45, ignition: true });
  });

  it("skips tripData points with an unreadable time or no location", () => {
    const readings = bouncieAdapter.parse({
      eventType: "tripData",
      imei: IMEI,
      data: [
        { timestamp: "2026-01-01T010:01:00.000Z", speed: 45, gps: { lat: 32.7, lon: -96.7 } }, // the docs' own example has a malformed time
        { timestamp: "2026-01-01T10:01:00.000Z", speed: 45, gps: {} },
        { timestamp: "2026-01-01T10:01:00.000Z", speed: 45, gps: { lat: 0, lon: 0 } },
      ],
    });
    expect(readings).toEqual([]);
  });

  it("reads trip end with odometer and ignition off", () => {
    const [r] = bouncieAdapter.parse({ eventType: "tripEnd", imei: IMEI, end: { timestamp: "2026-01-01T10:32:00.000Z", timeZone: "America/Chicago", odometer: 45691.4, fuelConsumed: 0.8 } });
    expect(r).toMatchObject({ kind: "trip_end", ignition: false, odometerMiles: 45691.4 });
  });

  it("treats a disconnect as a critical unplug alert with its location", () => {
    const [r] = bouncieAdapter.parse({ eventType: "disconnect", imei: IMEI, disconnect: { timestamp: "2026-01-01T08:30:00.000Z", timeZone: "America/Chicago", latitude: 32.7767432, longitude: -96.7970123 } });
    expect(r).toMatchObject({ kind: "unplugged", alertType: "device_unplugged", severity: "critical", latitude: 32.7767432 });
  });

  it("raises warnings for battery and check-engine events", () => {
    const [b] = bouncieAdapter.parse({ eventType: "battery", imei: IMEI, battery: { timestamp: "2026-01-01T08:30:00.000Z", status: "low" } });
    const [m] = bouncieAdapter.parse({ eventType: "mil", imei: IMEI, mil: { timestamp: "2026-01-01T08:30:00.000Z" } });
    expect(b).toMatchObject({ kind: "alert", alertType: "low_battery", severity: "warning" });
    expect(m).toMatchObject({ kind: "alert", alertType: "check_engine" });
  });

  it("ignores events we don't use, and junk, without throwing", () => {
    expect(bouncieAdapter.parse({ eventType: "tripMetrics", imei: IMEI })).toEqual([]);
    expect(bouncieAdapter.parse({ eventType: "tripEnd" })).toEqual([]); // no imei
    expect(bouncieAdapter.parse(null)).toEqual([]);
    expect(bouncieAdapter.parse("hello")).toEqual([]);
    expect(bouncieAdapter.parse([])).toEqual([]);
  });
});

describe("genericAdapter", () => {
  it("accepts a single object, an array, or a readings wrapper", () => {
    const one = { device_id: "gs-1", at: "2026-10-09T15:04:05Z", lat: 36.16, lng: -86.78, speed_mph: 31, ignition: true, odometer_miles: 100.4 };
    expect(genericAdapter.parse(one)).toHaveLength(1);
    expect(genericAdapter.parse([one, one])).toHaveLength(2);
    expect(genericAdapter.parse({ readings: [one] })).toHaveLength(1);
    expect(genericAdapter.parse(one)[0]).toMatchObject({ kind: "position", latitude: 36.16, speedMph: 31, odometerMiles: 100.4 });
  });

  it("rejects readings with no device, no time, or an impossible location", () => {
    expect(genericAdapter.parse({ at: "2026-10-09T15:04:05Z", lat: 36, lng: -86 })).toEqual([]);
    expect(genericAdapter.parse({ device_id: "x", lat: 36, lng: -86 })).toEqual([]);
    expect(genericAdapter.parse({ device_id: "x", at: "2026-10-09T15:04:05Z", lat: 136, lng: -86 })).toEqual([]);
    expect(genericAdapter.parse({ device_id: "x", at: "nonsense", lat: 36, lng: -86 })).toEqual([]);
  });

  it("lets non-position events through without a location", () => {
    const [r] = genericAdapter.parse({ device_id: "x", at: "2026-10-09T15:04:05Z", event: "unplugged" });
    expect(r).toMatchObject({ kind: "unplugged", alertType: "device_unplugged", severity: "critical" });
  });

  it("caps how many readings it takes in one call", () => {
    const many = Array.from({ length: 800 }, (_, i) => ({ device_id: "x", at: new Date(1_700_000_000_000 + i * 1000).toISOString(), lat: 36, lng: -86 }));
    expect(genericAdapter.parse(many)).toHaveLength(500);
  });

  it("adapterFor uses Bouncie's own translator only for Bouncie", () => {
    expect(adapterFor("bouncie")).toBe(bouncieAdapter);
    expect(adapterFor("goldstar")).toBe(genericAdapter);
    expect(adapterFor("other")).toBe(genericAdapter);
  });
});

function pos(at: string, lat = 36.1, lng = -86.7, extra: Partial<TrackerReading> = {}): TrackerReading {
  return { externalDeviceId: "d", kind: "position", occurredAt: at, latitude: lat, longitude: lng, raw: {}, ...extra };
}

describe("thinForStorage", () => {
  it("keeps one position a minute but every non-position event", () => {
    const readings: TrackerReading[] = [
      pos("2026-10-09T10:00:00Z"),
      pos("2026-10-09T10:00:10Z"),
      pos("2026-10-09T10:00:59Z"),
      pos("2026-10-09T10:01:00Z"),
      { externalDeviceId: "d", kind: "unplugged", occurredAt: "2026-10-09T10:00:20Z", raw: {} },
      pos("2026-10-09T10:02:30Z"),
    ];
    const kept = thinForStorage(readings);
    expect(kept.map((r) => `${r.kind}@${r.occurredAt.slice(11, 19)}`)).toEqual([
      "position@10:00:00",
      "unplugged@10:00:20",
      "position@10:01:00",
      "position@10:02:30",
    ]);
  });

  it("sorts out-of-order input first", () => {
    const kept = thinForStorage([pos("2026-10-09T10:05:00Z"), pos("2026-10-09T10:00:00Z")]);
    expect(kept.map((r) => r.occurredAt)).toEqual(["2026-10-09T10:00:00Z", "2026-10-09T10:05:00Z"]);
  });
});

describe("summarizeForCache", () => {
  const none = { last_seen_at: null, last_position_at: null };

  it("takes the newest location, ignition and odometer", () => {
    const u = summarizeForCache(
      [pos("2026-10-09T10:00:00Z", 36.1, -86.7, { speedMph: 30, ignition: true }), pos("2026-10-09T10:05:00Z", 36.2, -86.8, { speedMph: 0 }), { externalDeviceId: "d", kind: "trip_end", occurredAt: "2026-10-09T10:06:00Z", ignition: false, odometerMiles: 500.6, raw: {} }],
      none
    );
    expect(u).toMatchObject({ last_seen_at: "2026-10-09T10:06:00Z", last_latitude: 36.2, last_longitude: -86.8, last_position_at: "2026-10-09T10:05:00Z", last_ignition: false, last_odometer: 501 });
  });

  it("never moves backwards when an old message arrives late", () => {
    const u = summarizeForCache([pos("2026-10-09T09:00:00Z")], { last_seen_at: "2026-10-09T10:00:00Z", last_position_at: "2026-10-09T10:00:00Z" });
    expect(u).toEqual({});
  });

  it("an event with no location leaves the last location alone", () => {
    const u = summarizeForCache([{ externalDeviceId: "d", kind: "trip_start", occurredAt: "2026-10-09T11:00:00Z", ignition: true, raw: {} }], { last_seen_at: "2026-10-09T10:00:00Z", last_position_at: "2026-10-09T10:00:00Z" });
    expect(u).toEqual({ last_seen_at: "2026-10-09T11:00:00Z", last_ignition: true });
  });

  it("returns nothing for an empty batch", () => {
    expect(summarizeForCache([], none)).toEqual({});
  });
});

describe("status helpers", () => {
  const now = new Date("2026-10-09T12:00:00Z");

  it("trackerState reflects age, and unplug wins", () => {
    expect(trackerState({ lastSeenAt: null, hasOpenUnplugAlert: false }, now)).toBe("never");
    expect(trackerState({ lastSeenAt: "2026-10-09T11:00:00Z", hasOpenUnplugAlert: false }, now)).toBe("reporting");
    expect(trackerState({ lastSeenAt: "2026-10-08T23:00:00Z", hasOpenUnplugAlert: false }, now)).toBe("quiet");
    expect(trackerState({ lastSeenAt: "2026-10-06T12:00:00Z", hasOpenUnplugAlert: false }, now)).toBe("no_signal");
    expect(trackerState({ lastSeenAt: "2026-10-09T11:59:00Z", hasOpenUnplugAlert: true }, now)).toBe("unplugged");
  });

  it("timeAgo is readable", () => {
    expect(timeAgo(null, now)).toBe("Never");
    expect(timeAgo("2026-10-09T11:59:30Z", now)).toBe("Just now");
    expect(timeAgo("2026-10-09T11:30:00Z", now)).toBe("30 min ago");
    expect(timeAgo("2026-10-09T07:00:00Z", now)).toBe("5 h ago");
    expect(timeAgo("2026-10-05T12:00:00Z", now)).toBe("4 days ago");
  });

  it("parseCoordinates reads pasted coordinates and rejects bad ones", () => {
    expect(parseCoordinates("36.1627, -86.7816")).toEqual({ lat: 36.1627, lng: -86.7816 });
    expect(parseCoordinates("36.1627 -86.7816")).toEqual({ lat: 36.1627, lng: -86.7816 });
    expect(parseCoordinates("136.1, -86.7")).toBeNull();
    expect(parseCoordinates("Nashville")).toBeNull();
    expect(parseCoordinates("")).toBeNull();
  });

  it("alertLabel falls back to a readable name", () => {
    expect(alertLabel("device_unplugged")).toBe("Tracker unplugged");
    expect(alertLabel("odd_new_thing")).toBe("Odd new thing");
  });
});
