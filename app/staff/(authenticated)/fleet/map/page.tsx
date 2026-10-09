import Link from "next/link";
import { loadTrackedVehicles } from "../gps/data";
import MapLoader from "./map-loader";
import type { MapPin } from "./fleet-map";
import { STATE_LABELS, mapsLink, timeAgo } from "@/lib/telematics/status";

export const dynamic = "force-dynamic";

const COLORS = { reporting: "#16a34a", quiet: "#f59e0b", bad: "#dc2626", idle: "#98a2b3" } as const;

function pinColor(state: string): string {
  if (state === "reporting") return COLORS.reporting;
  if (state === "quiet") return COLORS.quiet;
  if (state === "unplugged" || state === "no_signal") return COLORS.bad;
  return COLORS.idle;
}

export default async function FleetMapPage() {
  const { vehicles, needsMigration } = await loadTrackedVehicles();

  if (needsMigration) {
    return (
      <div className="page">
        <h1 className="page-title">Fleet map</h1>
        <div className="card" style={{ maxWidth: 600 }}>
          <h2 className="card-title card-title--tight">One database update needed</h2>
          <p className="muted-text">Tracking needs migration 0092 to be run in Supabase. Run it in the SQL editor, then refresh this page.</p>
        </div>
      </div>
    );
  }

  const pins: MapPin[] = [];
  const missing: string[] = [];
  for (const v of vehicles) {
    const t = v.tracker;
    if (t && t.latitude !== null && t.longitude !== null) {
      pins.push({
        id: v.vehicleId,
        name: v.name,
        plate: v.plate,
        renter: v.renter,
        lat: t.latitude,
        lng: t.longitude,
        color: pinColor(v.state),
        stateLabel: v.state === "untracked" ? "No tracker" : STATE_LABELS[v.state],
        seen: timeAgo(t.lastPositionAt),
        speed: t.speed,
        mapsUrl: mapsLink(t.latitude, t.longitude),
      });
    } else {
      missing.push(`${v.name}${v.plate ? ` (${v.plate})` : ""}`);
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Fleet map</h1>
      <p className="muted-text" style={{ marginBottom: 16 }}>
        Last known location of every car. Manage trackers on{" "}
        <Link href="/staff/fleet/gps" style={{ color: "var(--teal-dark)", fontWeight: 600 }}>GPS tracking</Link>.
      </p>

      <div className="map-legend">
        <span><span className="map-legend__dot" style={{ background: COLORS.reporting }} />Reporting</span>
        <span><span className="map-legend__dot" style={{ background: COLORS.quiet }} />Quiet (12 h+)</span>
        <span><span className="map-legend__dot" style={{ background: COLORS.bad }} />No signal or unplugged</span>
        <span><span className="map-legend__dot" style={{ background: COLORS.idle }} />Waiting for first signal</span>
      </div>

      <MapLoader pins={pins} />

      {pins.length === 0 && (
        <p className="muted-text" style={{ marginTop: 12 }}>
          No locations yet. Add a tracker or note a location by hand on the GPS tracking page.
        </p>
      )}
      {missing.length > 0 && pins.length > 0 && (
        <p className="muted-text" style={{ marginTop: 12 }}>Not on the map (no location yet): {missing.join(", ")}.</p>
      )}
    </div>
  );
}
