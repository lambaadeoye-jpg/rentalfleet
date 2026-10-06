"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { scheduleRental, previewRentalRate, type AvailableVehicle, type RatePreview } from "../rental-actions";

export default function StartRentalForm({
  applicationId,
  vehicles,
  hasOwnInsurance,
}: {
  applicationId: string;
  vehicles: AvailableVehicle[];
  hasOwnInsurance: boolean | null;
}) {
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState("");
  const [rentalOption, setRentalOption] = useState<"daily" | "weekly">("weekly");
  const [arrangement, setArrangement] = useState<"own" | "via_provider" | "">(
    hasOwnInsurance === true ? "own" : hasOwnInsurance === false ? "via_provider" : ""
  );
  const [preview, setPreview] = useState<RatePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!arrangement) {
      setPreview(null);
      return;
    }
    previewRentalRate(rentalOption, arrangement).then((r) => {
      if (!cancelled) setPreview(r);
    });
    return () => {
      cancelled = true;
    };
  }, [rentalOption, arrangement]);

  async function handleSchedule() {
    if (!vehicleId) {
      setError("Select a vehicle first.");
      return;
    }
    if (!arrangement) {
      setError("Choose whether the renter has their own insurance.");
      return;
    }
    setError(null);
    setLoading(true);

    const result = await scheduleRental(applicationId, vehicleId, rentalOption, arrangement);

    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't schedule the rental. Please try again.");
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
      <h3 style={{ fontSize: 16, marginBottom: 12 }}>Schedule Rental</h3>

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

      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Insurance (staff only)</span>
        <select value={arrangement} onChange={(e) => setArrangement(e.target.value as "own" | "via_provider" | "")}>
          <option value="">{hasOwnInsurance === null ? "Choose..." : "Choose..."}</option>
          <option value="own">Has their own insurance</option>
          <option value="via_provider">No insurance: buying cover from a provider</option>
        </select>
      </label>

      {preview && preview.ok && (
        <p className="muted-text" style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>
          Rent: ${preview.rent.toFixed(2)} {preview.perLabel} (standard ${preview.base.toFixed(2)}). Refundable deposit: ${preview.deposit.toFixed(2)}, collected separately before pickup. Locked in when scheduled.
        </p>
      )}
      {preview && !preview.ok && <p className="error-text" style={{ fontSize: 13, marginBottom: 12 }}>{preview.error}</p>}

      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

      <button onClick={handleSchedule} disabled={loading} className="button-primary">
        {loading ? "Scheduling..." : "Schedule Rental"}
      </button>

      <p className="muted-text" style={{ fontSize: 12, marginTop: 10 }}>
        Reserves the vehicle and creates the rental record. The vehicle isn&apos;t handed over
        yet -- that happens separately in Fleet, when whoever&apos;s doing the physical pickup
        confirms it.
      </p>
    </div>
  );
}
