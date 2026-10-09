import Link from "next/link";
import { loadTrackedVehicles } from "./data";
import { AddTrackerForm, ManualLocationForm, RemoveTrackerButton, ResolveAlertButton } from "./tracker-forms";
import { PROVIDER_LABELS, type Provider } from "@/lib/telematics/types";
import { STATE_LABELS, alertLabel, mapsLink, timeAgo, type TrackerState } from "@/lib/telematics/status";
import { STATUS_LABELS } from "../constants";

export const dynamic = "force-dynamic";

const STATE_TAG: Record<TrackerState | "untracked", string> = {
  reporting: "tag tag--good",
  quiet: "tag tag--warn",
  no_signal: "tag tag--bad",
  unplugged: "tag tag--bad",
  never: "tag",
  untracked: "tag",
};

const WEBHOOK_BASE = "https://rentzivo.com/api/telematics";

export default async function GpsTrackingPage() {
  const { vehicles, alerts, needsMigration } = await loadTrackedVehicles();
  const options = vehicles.map((v) => ({ id: v.vehicleId, label: `${v.name}${v.plate ? ` · ${v.plate}` : ""}` }));
  const nameById = new Map(vehicles.map((v) => [v.vehicleId, `${v.name}${v.plate ? ` · ${v.plate}` : ""}`]));

  const count = (pred: (s: string) => boolean) => vehicles.filter((v) => pred(v.state)).length;
  const stats = [
    { value: count((s) => s === "reporting"), label: "Reporting" },
    { value: count((s) => s === "quiet" || s === "no_signal" || s === "never"), label: "Quiet or waiting" },
    { value: count((s) => s === "unplugged"), label: "Unplugged" },
    { value: count((s) => s === "untracked"), label: "No tracker" },
  ];

  if (needsMigration) {
    return (
      <div className="page">
        <h1 className="page-title">GPS tracking</h1>
        <div className="card" style={{ maxWidth: 600 }}>
          <h2 className="card-title card-title--tight">One database update needed</h2>
          <p className="muted-text">Tracking needs migration 0092 to be run in Supabase. Run it in the SQL editor, then refresh this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">GPS tracking</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Every car’s tracker in one place, whichever company made it. See all locations on the{" "}
        <Link href="/staff/fleet/map" style={{ color: "var(--teal-dark)", fontWeight: 600 }}>Fleet map</Link>.
      </p>

      <div className="stat-grid">
        {stats.map((s) => (
          <div key={s.label} className="stat-tile">
            <div className="stat-tile__value">{s.value}</div>
            <div className="stat-tile__label">{s.label}</div>
          </div>
        ))}
      </div>

      {alerts.length > 0 && (
        <div className="card" style={{ marginBottom: 20, padding: 0, overflowX: "auto" }}>
          <h2 className="card-title" style={{ padding: "20px 24px 0" }}>Needs a look</h2>
          <table className="data-table">
            <thead>
              <tr>{["Problem", "Vehicle", "Since", ""].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td className="cell-strong"><span className={a.severity === "critical" ? "tag tag--bad" : "tag tag--warn"}>{alertLabel(a.type)}</span></td>
                  <td className="cell-muted">{nameById.get(a.vehicleId) ?? "Vehicle"}</td>
                  <td className="cell-muted">{timeAgo(a.createdAt)}</td>
                  <td><ResolveAlertButton alertId={a.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 28 }}>
        {vehicles.length === 0 ? (
          <p className="muted-text" style={{ padding: 24 }}>No vehicles yet. Add one on the Fleet page first.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>{["Vehicle", "Tracker", "Status", "Last location", "Ignition", "Odometer", ""].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {vehicles.map((v) => {
                const t = v.tracker;
                return (
                  <tr key={v.vehicleId}>
                    <td className="cell-strong">
                      {v.name}
                      <div style={{ fontSize: 12, fontWeight: 400, color: "var(--text-secondary)" }}>
                        {[v.plate, STATUS_LABELS[v.vehicleStatus] ?? v.vehicleStatus, v.renter].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="cell-muted">
                      {t ? (
                        <>
                          {PROVIDER_LABELS[t.provider as Provider] ?? t.provider}
                          <div style={{ fontSize: 12 }}>{t.nickname ?? (t.provider === "manual" ? "" : t.externalId)}</div>
                        </>
                      ) : "—"}
                    </td>
                    <td><span className={STATE_TAG[v.state]}>{v.state === "untracked" ? "No tracker" : STATE_LABELS[v.state]}</span></td>
                    <td className="cell-muted">
                      {t && t.latitude !== null && t.longitude !== null ? (
                        <>
                          <a href={mapsLink(t.latitude, t.longitude)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-dark)", fontWeight: 600 }}>
                            {timeAgo(t.lastPositionAt)}
                          </a>
                          {t.speed !== null && t.speed > 0 && <div style={{ fontSize: 12 }}>{Math.round(t.speed)} mph</div>}
                        </>
                      ) : t ? "No location yet" : "—"}
                    </td>
                    <td className="cell-muted">{t?.ignition === true ? "On" : t?.ignition === false ? "Off" : "—"}</td>
                    <td className="cell-muted">{t?.odometer != null ? `${t.odometer.toLocaleString()} mi` : "—"}</td>
                    <td>{t && t.provider !== "manual" ? <RemoveTrackerButton deviceId={t.id} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: "grid", gap: 20, marginBottom: 28 }}>
        <AddTrackerForm vehicles={options} />
        <ManualLocationForm vehicles={options} />
      </div>

      <div className="card" style={{ maxWidth: 760 }}>
        <h2 className="card-title">Connecting a tracking company</h2>
        <p className="muted-text" style={{ marginBottom: 12 }}>
          Trackers send their messages to a web address. Use the address for the company, and set the same secret key on both sides
          (it is the <code>TELEMATICS_WEBHOOK_SECRET</code> setting for this site).
        </p>
        <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Bouncie</p>
        <div className="code-line" style={{ marginBottom: 8 }}>{WEBHOOK_BASE}/bouncie</div>
        <ol className="muted-text" style={{ paddingLeft: 20, marginBottom: 16, lineHeight: 1.6 }}>
          <li>Register an app at the Bouncie developer portal and add the address above as its webhook, with your secret key.</li>
          <li>Choose the events: trip start, trip end, trip data, device disconnect and connect, battery and check-engine.</li>
          <li>Authorize your Bouncie account with the app, then add each device here using the IMEI printed on it.</li>
        </ol>
        <p className="muted-text" style={{ marginBottom: 16 }}>
          A parked Bouncie checks in only every few hours, so “Quiet” on a parked car is normal. A car that is out on rent and has been
          quiet for a day is worth a call.
        </p>
        <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>GoldStar and anything else</p>
        <div className="code-line" style={{ marginBottom: 8 }}>{WEBHOOK_BASE}/goldstar</div>
        <p className="muted-text">
          Send the secret key in an <code>x-telematics-secret</code> header and a JSON body such as{" "}
          <code>{`{"device_id":"...","at":"2026-10-09T15:04:05Z","lat":36.16,"lng":-86.78,"speed_mph":31,"ignition":true}`}</code>. This
          works from n8n or Zapier, so GoldStar can be connected through whatever export or API access they give you.
        </p>
      </div>
    </div>
  );
}
