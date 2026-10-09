// One shape for every tracker. Each provider's messages are translated into
// TrackerReading by an adapter (adapters.ts); everything downstream -- the
// database, the fleet map, alerts -- only ever sees this shape.

export const PROVIDERS = ["bouncie", "goldstar", "other", "manual"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<Provider, string> = {
  bouncie: "Bouncie",
  goldstar: "GoldStar",
  other: "Other tracker",
  manual: "Manual entry",
};

export type ReadingKind =
  | "position" // a location fix
  | "trip_start"
  | "trip_end"
  | "unplugged" // tracker lost power: unplugged or tampered with
  | "plugged" // tracker power restored
  | "alert"; // anything else worth a human look (low battery, check engine ...)

export type AlertSeverity = "info" | "warning" | "critical";

export type TrackerReading = {
  /** The id the provider uses for the device (Bouncie: IMEI). */
  externalDeviceId: string;
  kind: ReadingKind;
  /** ISO 8601, UTC. */
  occurredAt: string;
  latitude?: number;
  longitude?: number;
  speedMph?: number;
  ignition?: boolean;
  odometerMiles?: number;
  batteryVolts?: number;
  alertType?: string;
  severity?: AlertSeverity;
  /** The provider's original message, kept so nothing is lost if we mis-read a field. */
  raw: unknown;
};

export type TrackerAdapter = {
  id: string;
  /** Turns one webhook body into zero or more readings. Never throws on odd input: returns []. */
  parse(body: unknown): TrackerReading[];
};
