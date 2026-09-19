"use client";

import { useState } from "react";
import { updateVehicleStatus } from "./actions";
import { VEHICLE_STATUSES, STATUS_LABELS, STATUS_COLOR } from "./constants";

type Vehicle = {
  id: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  plate: string | null;
  mileage: number;
  status: string;
  categoryName: string;
};

export default function FleetTable({ vehicles }: { vehicles: Vehicle[] }) {
  const [rows, setRows] = useState(vehicles);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  async function handleStatusChange(vehicleId: string, newStatus: string) {
    setSavingId(vehicleId);
    setErrorById((prev) => ({ ...prev, [vehicleId]: "" }));

    const result = await updateVehicleStatus(vehicleId, newStatus);
    setSavingId(null);

    if (!result.success) {
      setErrorById((prev) => ({ ...prev, [vehicleId]: result.error ?? "Couldn't update." }));
      return;
    }
    setRows((prev) => prev.map((v) => (v.id === vehicleId ? { ...v, status: newStatus } : v)));
  }

  if (rows.length === 0) {
    return <p className="muted-text">No vehicles yet. Add your first one above.</p>;
  }

  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
            {["Vehicle", "Category", "Plate", "Mileage", "Status"].map((h) => (
              <th key={h} style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)", fontWeight: 700 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                {v.year} {v.make} {v.model}
                {v.vin && <div style={{ fontSize: 12, fontWeight: 400, color: "var(--text-secondary)" }}>{v.vin}</div>}
              </td>
              <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>{v.categoryName}</td>
              <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>{v.plate ?? "—"}</td>
              <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>{v.mileage.toLocaleString()}</td>
              <td style={{ padding: "12px 16px" }}>
                <select
                  value={v.status}
                  disabled={savingId === v.id}
                  onChange={(e) => handleStatusChange(v.id, e.target.value)}
                  style={{ fontSize: 13, padding: "6px 8px", color: STATUS_COLOR[v.status], fontWeight: 700 }}
                >
                  {VEHICLE_STATUSES.map((s) => (
                    <option key={s} value={s} style={{ color: "var(--text)", fontWeight: 400 }}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                {errorById[v.id] && (
                  <p className="error-text" style={{ fontSize: 12, marginTop: 4 }}>
                    {errorById[v.id]}
                  </p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
