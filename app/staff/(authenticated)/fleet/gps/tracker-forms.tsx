"use client";

import { useState, type FormEvent } from "react";
import { addTracker, logManualLocation, removeTracker, resolveAlert } from "./actions";
import { PROVIDER_LABELS, PROVIDERS } from "@/lib/telematics/types";

type VehicleOption = { id: string; label: string };

export function AddTrackerForm({ vehicles }: { vehicles: VehicleOption[] }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [provider, setProvider] = useState("bouncie");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    setDone(false);
    setLoading(true);
    const data = new FormData(form);
    const result = await addTracker({
      vehicleId: String(data.get("vehicleId") || ""),
      provider: String(data.get("provider") || ""),
      externalId: String(data.get("externalId") || ""),
      nickname: String(data.get("nickname") || ""),
    });
    setLoading(false);
    if (!result.success) return setError(result.error ?? "Couldn’t add that tracker.");
    form.reset();
    setProvider("bouncie");
    setDone(true);
  }

  return (
    <form onSubmit={onSubmit} className="card" style={{ maxWidth: 600 }}>
      <h2 className="card-title card-title--tight">Add a tracker</h2>
      <p className="muted-text" style={{ marginBottom: 16 }}>Link a tracker to a car. Its location then shows on the Fleet map.</p>
      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Vehicle</span>
        <select name="vehicleId" required defaultValue="">
          <option value="" disabled>Select a vehicle</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </label>
      <div className="form-row">
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Tracker type</span>
          <select name="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {PROVIDERS.filter((p) => p !== "manual").map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
          </select>
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>{provider === "bouncie" ? "Device IMEI" : "Device ID"}</span>
          <input name="externalId" required maxLength={64} placeholder={provider === "bouncie" ? "15-digit number on the device" : "As the provider reports it"} />
        </label>
      </div>
      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Label (optional)</span>
        <input name="nickname" maxLength={60} placeholder="e.g. Under dash, driver side" />
      </label>
      {error && <p className="error-text" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      {done && <p className="muted-text" style={{ marginBottom: 12 }}>Tracker added.</p>}
      <button type="submit" className="button-primary" disabled={loading}>{loading ? "Adding…" : "Add tracker"}</button>
    </form>
  );
}

export function ManualLocationForm({ vehicles }: { vehicles: VehicleOption[] }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    setDone(false);
    setLoading(true);
    const data = new FormData(form);
    const result = await logManualLocation({ vehicleId: String(data.get("vehicleId") || ""), coordinates: String(data.get("coordinates") || "") });
    setLoading(false);
    if (!result.success) return setError(result.error ?? "Couldn’t save that location.");
    form.reset();
    setDone(true);
  }

  return (
    <form onSubmit={onSubmit} className="card" style={{ maxWidth: 600 }}>
      <h2 className="card-title card-title--tight">Note a car’s location by hand</h2>
      <p className="muted-text" style={{ marginBottom: 16 }}>For a car with no working tracker. In Google Maps, right-click the spot and click the coordinates to copy them.</p>
      <div className="form-row">
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Vehicle</span>
          <select name="vehicleId" required defaultValue="">
            <option value="" disabled>Select a vehicle</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Coordinates</span>
          <input name="coordinates" required placeholder="36.1627, -86.7816" />
        </label>
      </div>
      {error && <p className="error-text" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      {done && <p className="muted-text" style={{ marginBottom: 12 }}>Location saved.</p>}
      <button type="submit" className="button-secondary" disabled={loading}>{loading ? "Saving…" : "Save location"}</button>
    </form>
  );
}

export function RemoveTrackerButton({ deviceId }: { deviceId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onClick() {
    if (!window.confirm("Remove this tracker from the car? Its past locations are kept.")) return;
    setBusy(true);
    const result = await removeTracker(deviceId);
    setBusy(false);
    if (!result.success) setError(result.error ?? "Couldn’t remove it.");
  }
  return (
    <>
      <button type="button" className="link-button" onClick={onClick} disabled={busy}>{busy ? "Removing…" : "Remove"}</button>
      {error && <p className="error-text" style={{ fontSize: 12 }}>{error}</p>}
    </>
  );
}

export function ResolveAlertButton({ alertId }: { alertId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onClick() {
    setBusy(true);
    const result = await resolveAlert(alertId);
    setBusy(false);
    if (!result.success) setError(result.error ?? "Couldn’t resolve it.");
  }
  return (
    <>
      <button type="button" className="link-button" onClick={onClick} disabled={busy}>{busy ? "Saving…" : "Mark reviewed"}</button>
      {error && <p className="error-text" style={{ fontSize: 12 }}>{error}</p>}
    </>
  );
}
