"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { exportCustomers, exportVehicles, exportBookings, exportRentals, exportPayments, exportCharges } from "./actions";

const EXPORTS = [
  { label: "Customers", fn: exportCustomers, filename: "customers.csv" },
  { label: "Vehicles", fn: exportVehicles, filename: "vehicles.csv" },
  { label: "Bookings", fn: exportBookings, filename: "bookings.csv" },
  { label: "Rentals", fn: exportRentals, filename: "rentals.csv" },
  { label: "Payments", fn: exportPayments, filename: "payments.csv" },
  { label: "Charges", fn: exportCharges, filename: "charges.csv" },
] as const;

export default function ExportButtons() {
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(item: (typeof EXPORTS)[number]) {
    setError(null);
    setLoadingLabel(item.label);

    try {
      const csv = await item.fn();
      if (!csv) {
        setError(`No ${item.label.toLowerCase()} data to export yet.`);
        setLoadingLabel(null);
        return;
      }
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(`Couldn't export ${item.label.toLowerCase()}. Please try again.`);
    }
    setLoadingLabel(null);
  }

  return (
    <div style={{ maxWidth: 480 }}>
      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {EXPORTS.map((item) => (
          <button
            key={item.label}
            onClick={() => handleExport(item)}
            disabled={loadingLabel === item.label}
            className="card"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              cursor: "pointer",
              border: "1px solid var(--border)",
              background: "white",
              width: "100%",
              textAlign: "left",
            }}
          >
            <span style={{ fontWeight: 600 }}>{item.label}</span>
            <Download size={16} color={loadingLabel === item.label ? "var(--text-secondary)" : "var(--teal)"} />
          </button>
        ))}
      </div>
    </div>
  );
}
