import type { AlertSeverity, ReadingKind, TrackerAdapter, TrackerReading } from "./types";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function iso(v: unknown): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const ms = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function validCoords(lat: number | undefined, lng: number | undefined): boolean {
  return lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

// Keeps location fields only when they make sense, so a bad 0,0 fix never reaches the map.
function withCoords(lat: unknown, lng: unknown): { latitude?: number; longitude?: number } {
  const la = num(lat);
  const lo = num(lng);
  return validCoords(la, lo) ? { latitude: la, longitude: lo } : {};
}

// ---- Bouncie ----------------------------------------------------------
// Field names follow https://docs.bouncie.dev. tripData, tripEnd and
// disconnect were read from the published examples. tripStart, connect,
// battery and mil are parsed defensively because their examples were not
// checked; the raw message is always stored either way.

export const bouncieAdapter: TrackerAdapter = {
  id: "bouncie",
  parse(body) {
    if (!isObj(body)) return [];
    const imei = body.imei;
    if (typeof imei !== "string" && typeof imei !== "number") return [];
    const externalDeviceId = String(imei).trim();
    if (!externalDeviceId) return [];

    const out: TrackerReading[] = [];
    const base = { externalDeviceId, raw: body };
    const eventType = body.eventType;

    if (eventType === "tripData" && Array.isArray(body.data)) {
      for (const point of body.data) {
        if (!isObj(point)) continue;
        const occurredAt = iso(point.timestamp);
        const gps = isObj(point.gps) ? point.gps : {};
        const coords = withCoords(gps.lat, gps.lon);
        if (!occurredAt || coords.latitude === undefined) continue;
        out.push({ ...base, kind: "position", occurredAt, ...coords, speedMph: num(point.speed), ignition: true, raw: point });
      }
      return out;
    }

    if (eventType === "tripStart") {
      const start = isObj(body.start) ? body.start : {};
      const occurredAt = iso(start.timestamp);
      if (occurredAt) out.push({ ...base, kind: "trip_start", occurredAt, ignition: true, odometerMiles: num(start.odometer) });
      return out;
    }

    if (eventType === "tripEnd") {
      const end = isObj(body.end) ? body.end : {};
      const occurredAt = iso(end.timestamp);
      if (occurredAt) out.push({ ...base, kind: "trip_end", occurredAt, ignition: false, odometerMiles: num(end.odometer) });
      return out;
    }

    if (eventType === "disconnect") {
      const d = isObj(body.disconnect) ? body.disconnect : {};
      const occurredAt = iso(d.timestamp);
      if (occurredAt) {
        out.push({
          ...base,
          kind: "unplugged",
          occurredAt,
          ...withCoords(d.latitude, d.longitude),
          alertType: "device_unplugged",
          severity: "critical",
        });
      }
      return out;
    }

    if (eventType === "connect") {
      const c = isObj(body.connect) ? body.connect : {};
      const occurredAt = iso(c.timestamp);
      if (occurredAt) out.push({ ...base, kind: "plugged", occurredAt, ...withCoords(c.latitude, c.longitude) });
      return out;
    }

    if (eventType === "battery" || eventType === "mil") {
      const inner = isObj(body[eventType as string]) ? (body[eventType as string] as Obj) : {};
      const occurredAt = iso(inner.timestamp) ?? iso(inner.lastUpdated) ?? new Date().toISOString();
      out.push({
        ...base,
        kind: "alert",
        occurredAt,
        alertType: eventType === "battery" ? "low_battery" : "check_engine",
        severity: "warning",
      });
      return out;
    }

    // tripMetrics, vinChange, geozone events: acknowledged, nothing to store yet.
    return out;
  },
};

// ---- Generic JSON -----------------------------------------------------
// For GoldStar until its API is available, and for any tracker that can be
// wired through n8n, Zapier or a CSV export. Send one object, an array, or
// { "readings": [...] }. Each reading:
//   { "device_id": "...", "at": "2026-10-09T15:04:05Z",
//     "lat": 36.16, "lng": -86.78, "speed_mph": 31, "ignition": true,
//     "odometer_miles": 45691.4,
//     "event": "position",   // or trip_start, trip_end, unplugged, plugged, alert
//     "alert_type": "...", "severity": "warning" }   // alert fields optional

const KINDS: ReadingKind[] = ["position", "trip_start", "trip_end", "unplugged", "plugged", "alert"];
const SEVERITIES: AlertSeverity[] = ["info", "warning", "critical"];
export const GENERIC_MAX_READINGS = 500;

export const genericAdapter: TrackerAdapter = {
  id: "generic",
  parse(body) {
    const items: unknown[] = Array.isArray(body) ? body : isObj(body) && Array.isArray(body.readings) ? body.readings : [body];
    const out: TrackerReading[] = [];
    for (const item of items.slice(0, GENERIC_MAX_READINGS)) {
      if (!isObj(item)) continue;
      const id = item.device_id;
      if (typeof id !== "string" && typeof id !== "number") continue;
      const externalDeviceId = String(id).trim();
      const occurredAt = iso(item.at) ?? iso(item.timestamp);
      if (!externalDeviceId || !occurredAt) continue;

      const kind: ReadingKind = KINDS.includes(item.event as ReadingKind) ? (item.event as ReadingKind) : "position";
      const coords = withCoords(item.lat, item.lng);
      if (kind === "position" && coords.latitude === undefined) continue; // a position with no usable fix is useless

      const severity = SEVERITIES.includes(item.severity as AlertSeverity) ? (item.severity as AlertSeverity) : undefined;
      const alertType =
        typeof item.alert_type === "string" && item.alert_type.trim()
          ? item.alert_type.trim().slice(0, 60)
          : kind === "unplugged"
            ? "device_unplugged"
            : undefined;

      out.push({
        externalDeviceId,
        kind,
        occurredAt,
        ...coords,
        speedMph: num(item.speed_mph),
        ignition: typeof item.ignition === "boolean" ? item.ignition : undefined,
        odometerMiles: num(item.odometer_miles),
        batteryVolts: num(item.battery_volts),
        alertType,
        severity: severity ?? (kind === "unplugged" ? "critical" : alertType ? "warning" : undefined),
        raw: item,
      });
    }
    return out;
  },
};

/** Picks the translator for a provider. Anything without its own adapter uses the generic format. */
export function adapterFor(provider: string): TrackerAdapter {
  return provider === "bouncie" ? bouncieAdapter : genericAdapter;
}
