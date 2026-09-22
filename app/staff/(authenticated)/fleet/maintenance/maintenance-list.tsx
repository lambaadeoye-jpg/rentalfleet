"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createWorkOrder, completeWorkOrder, type WorkOrder, type VehicleOption } from "./actions";

export default function MaintenanceList({
  initialWorkOrders,
  vehicles,
}: {
  initialWorkOrders: WorkOrder[];
  vehicles: VehicleOption[];
}) {
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState("");
  const [workType, setWorkType] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completeCost, setCompleteCost] = useState("");

  async function handleCreate() {
    setError(null);
    setWarning(null);
    setLoading(true);
    const result = await createWorkOrder(vehicleId, workType, notes);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't create that work order.");
      return;
    }
    if (result.warning) setWarning(result.warning);
    setVehicleId("");
    setWorkType("");
    setNotes("");
    router.refresh();
  }

  async function handleComplete(workOrderId: string) {
    const cost = completeCost ? Number(completeCost) : null;
    const confirmed = window.confirm("Mark this work order complete and free the vehicle back to available?");
    if (!confirmed) return;

    const result = await completeWorkOrder(workOrderId, cost);
    if (!result.success) {
      setError(result.error ?? "Couldn't complete that work order.");
      return;
    }
    setCompletingId(null);
    setCompleteCost("");
    router.refresh();
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Log a work order</h2>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Vehicle</span>
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Select a vehicle</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Work type</span>
          <input value={workType} onChange={(e) => setWorkType(e.target.value)} placeholder="e.g. Oil change, brake repair" />
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Notes (optional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
        {warning && <p style={{ color: "var(--warning, #b45309)", fontSize: 13, marginBottom: 12 }}>{warning}</p>}
        <button onClick={handleCreate} disabled={loading || !vehicleId} className="button-primary">
          {loading ? "Logging..." : "Log Work Order"}
        </button>
      </div>

      {initialWorkOrders.map((w) => (
        <div key={w.id} className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 700 }}>{w.vehicleLabel}</div>
              <div className="muted-text" style={{ fontSize: 13 }}>
                {w.workType ?? "General maintenance"} — <span style={{ textTransform: "capitalize" }}>{w.status}</span>
              </div>
              {w.notes && <div className="muted-text" style={{ fontSize: 13, marginTop: 4 }}>{w.notes}</div>}
              {w.cost != null && <div style={{ fontSize: 13, marginTop: 4 }}>Cost: ${Number(w.cost).toFixed(2)}</div>}
            </div>
            {w.status === "open" &&
              (completingId === w.id ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="number"
                    placeholder="Cost"
                    value={completeCost}
                    onChange={(e) => setCompleteCost(e.target.value)}
                    style={{ width: 80 }}
                  />
                  <button onClick={() => handleComplete(w.id)} className="button-primary" style={{ padding: "6px 10px", fontSize: 13 }}>
                    Confirm
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCompletingId(w.id)}
                  className="button-secondary"
                  style={{ color: "var(--text)", borderColor: "var(--border)" }}
                >
                  Mark Complete
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
