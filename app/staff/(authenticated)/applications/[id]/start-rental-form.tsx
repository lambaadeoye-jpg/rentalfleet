"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRental, type AvailableVehicle } from "../rental-actions";

export default function StartRentalForm({
  applicationId,
  vehicles,
}: {
  applicationId: string;
  vehicles: AvailableVehicle[];
}) {
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState("");
  const [rentalOption, setRentalOption] = useState<"daily" | "weekly">("weekly");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    if (!vehicleId) {
      setError("Select a vehicle first.");
      return;
    }
    setError(null);
    setLoading(true);

    const result = await startRental(applicationId, vehicleId, rentalOption);

    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't start the rental. Please try again.");
      return;
    }

    router.refresh();
  }

  if (vehicles.length === 0) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <p className="muted-text" style={{ fontSize: 14 }}>
          No vehicles are currently available to assign. Add or free up a vehicle in{" "}
          <a href="/staff/fleet" style={{ color: "var(--teal)" }}>
            Fleet
          </a>{" "}
          first.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 16, marginBottom: 12 }}>Start Rental</h3>

      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Vehicle</span>
        <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">Select an available vehicle</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.year} {v.make} {v.model} {v.vin ? `(${v.vin})` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Rental option</span>
        <select value={rentalOption} onChange={(e) => setRentalOption(e.target.value as "daily" | "weekly")}>
          <option value="weekly">Weekly</option>
          <option value="daily">Daily</option>
        </select>
      </label>

      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

      <button onClick={handleStart} disabled={loading} className="button-primary">
        {loading ? "Starting..." : "Start Rental"}
      </button>

      <p className="muted-text" style={{ fontSize: 12, marginTop: 10 }}>
        This creates the booking and rental, assigns the vehicle, and marks it rented --
        enforced by the database, not just this screen.
      </p>
    </div>
  );
}
