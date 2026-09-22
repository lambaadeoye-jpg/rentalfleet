"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logIncident, resolveIncident, type IncidentRecord, type VehicleOption, type CustomerOption } from "./actions";

export default function IncidentList({
  initialIncidents,
  vehicles,
  customers,
}: {
  initialIncidents: IncidentRecord[];
  vehicles: VehicleOption[];
  customers: CustomerOption[];
}) {
  const router = useRouter();
  const [incidentType, setIncidentType] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLog() {
    setError(null);
    setLoading(true);
    const result = await logIncident(incidentType, vehicleId, customerId, description);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't log that incident.");
      return;
    }
    setIncidentType("");
    setVehicleId("");
    setCustomerId("");
    setDescription("");
    router.refresh();
  }

  async function handleResolve(incidentId: string) {
    const confirmed = window.confirm("Mark this incident as resolved?");
    if (!confirmed) return;

    const result = await resolveIncident(incidentId);
    if (!result.success) {
      setError(result.error ?? "Couldn't resolve that incident.");
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Log an incident</h2>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Type</span>
          <input value={incidentType} onChange={(e) => setIncidentType(e.target.value)} placeholder="e.g. Accident, vandalism, mechanical failure" />
        </label>
        <div className="form-row">
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Vehicle (optional)</span>
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">None</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Customer (optional)</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">None</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
        <button onClick={handleLog} disabled={loading || !incidentType.trim()} className="button-primary">
          {loading ? "Logging..." : "Log Incident"}
        </button>
      </div>

      {initialIncidents.map((i) => (
        <div key={i.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700 }}>{i.incidentType}</div>
            <div className="muted-text" style={{ fontSize: 13 }}>
              {[i.vehicleLabel, i.customerName].filter(Boolean).join(" — ") || "No vehicle/customer linked"}
            </div>
            {i.description && <div className="muted-text" style={{ fontSize: 13, marginTop: 4 }}>{i.description}</div>}
            <div style={{ fontSize: 12, marginTop: 4, textTransform: "capitalize" }}>{i.status}</div>
          </div>
          {i.status === "open" && (
            <button onClick={() => handleResolve(i.id)} className="button-secondary" style={{ color: "var(--text)", borderColor: "var(--border)" }}>
              Resolve
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
