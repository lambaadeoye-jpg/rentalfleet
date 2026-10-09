import { NO_SIGNAL_AFTER_HOURS, QUIET_AFTER_HOURS } from "./summarize";

export type TrackerState = "unplugged" | "reporting" | "quiet" | "no_signal" | "never";

export const STATE_LABELS: Record<TrackerState, string> = {
  unplugged: "Unplugged",
  reporting: "Reporting",
  quiet: "Quiet",
  no_signal: "No signal",
  never: "Waiting for first signal",
};

/** What a tracker's health looks like at a glance. An open unplug alert always wins. */
export function trackerState(
  input: { lastSeenAt: string | null; hasOpenUnplugAlert: boolean },
  now: Date = new Date()
): TrackerState {
  if (input.hasOpenUnplugAlert) return "unplugged";
  if (!input.lastSeenAt) return "never";
  const hours = (now.getTime() - Date.parse(input.lastSeenAt)) / 3_600_000;
  if (hours >= NO_SIGNAL_AFTER_HOURS) return "no_signal";
  if (hours >= QUIET_AFTER_HOURS) return "quiet";
  return "reporting";
}

/** "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "Never";
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (seconds < 90) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** Reads "36.1627, -86.7816" (as copied from Google Maps) into numbers, or null if it isn't a valid location. */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const m = text.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export const ALERT_LABELS: Record<string, string> = {
  device_unplugged: "Tracker unplugged",
  low_battery: "Low car battery",
  check_engine: "Check-engine light",
};

export function alertLabel(type: string): string {
  return ALERT_LABELS[type] ?? type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
