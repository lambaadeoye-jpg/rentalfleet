import type { TrackerReading } from "./types";

/** Plain position fixes closer together than this are not worth storing; the latest still updates the map. */
export const POSITION_MIN_GAP_SECONDS = 60;

/** No message for this long: the tracker is quiet (parked cars check in only every few hours). */
export const QUIET_AFTER_HOURS = 12;
/** No message for this long: treat the tracker as offline and look into it. */
export const NO_SIGNAL_AFTER_HOURS = 48;

function ms(iso: string): number {
  return Date.parse(iso);
}

/** Oldest first. */
export function sortByTime(readings: TrackerReading[]): TrackerReading[] {
  return [...readings].sort((a, b) => ms(a.occurredAt) - ms(b.occurredAt));
}

/**
 * Keeps every event that matters (trips, unplug, alerts) and thins plain
 * positions to at most one per POSITION_MIN_GAP_SECONDS. A car driving for
 * an hour can send thousands of fixes; one a minute is plenty for a trail.
 */
export function thinForStorage(readings: TrackerReading[], gapSeconds = POSITION_MIN_GAP_SECONDS): TrackerReading[] {
  const out: TrackerReading[] = [];
  let lastKept = -Infinity;
  for (const r of sortByTime(readings)) {
    if (r.kind !== "position") {
      out.push(r);
      continue;
    }
    const t = ms(r.occurredAt);
    if (t - lastKept >= gapSeconds * 1000) {
      out.push(r);
      lastKept = t;
    }
  }
  return out;
}

export type DeviceCacheUpdate = {
  last_seen_at?: string;
  last_position_at?: string;
  last_latitude?: number;
  last_longitude?: number;
  last_speed?: number | null;
  last_ignition?: boolean;
  last_odometer?: number;
};

type Previous = { last_seen_at: string | null; last_position_at: string | null };

/**
 * Works out what to write to a device's "latest state" columns from a batch,
 * never moving anything backwards: an old message arriving late must not
 * replace a newer location. Returns {} when there is nothing newer.
 */
export function summarizeForCache(readings: TrackerReading[], previous: Previous): DeviceCacheUpdate {
  const sorted = sortByTime(readings);
  const update: DeviceCacheUpdate = {};
  if (sorted.length === 0) return update;

  const prevSeen = previous.last_seen_at ? ms(previous.last_seen_at) : -Infinity;
  const prevPos = previous.last_position_at ? ms(previous.last_position_at) : -Infinity;

  const newest = sorted[sorted.length - 1];
  if (ms(newest.occurredAt) > prevSeen) {
    update.last_seen_at = newest.occurredAt;
    const withIgnition = [...sorted].reverse().find((r) => r.ignition !== undefined);
    if (withIgnition && ms(withIgnition.occurredAt) > prevSeen) update.last_ignition = withIgnition.ignition;
    const withOdometer = [...sorted].reverse().find((r) => r.odometerMiles !== undefined);
    if (withOdometer && ms(withOdometer.occurredAt) > prevSeen) update.last_odometer = Math.round(withOdometer.odometerMiles as number);
  }

  const withCoords = [...sorted].reverse().find((r) => r.latitude !== undefined && r.longitude !== undefined);
  if (withCoords && ms(withCoords.occurredAt) > prevPos) {
    update.last_position_at = withCoords.occurredAt;
    update.last_latitude = withCoords.latitude;
    update.last_longitude = withCoords.longitude;
    update.last_speed = withCoords.speedMph ?? null;
  }
  return update;
}
