"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { createVehicle } from "./actions";

type Category = { id: string; name: string };

export default function AddVehicleForm({ categories }: { categories: Category[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const result = await createVehicle({
      categoryId: String(form.get("categoryId") || ""),
      vin: String(form.get("vin") || ""),
      make: String(form.get("make") || ""),
      model: String(form.get("model") || ""),
      year: String(form.get("year") || ""),
      plate: String(form.get("plate") || ""),
      mileage: String(form.get("mileage") || ""),
    });

    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't add that vehicle. Please try again.");
      return;
    }

    setOpen(false);
    (e.target as HTMLFormElement).reset();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="button-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Plus size={16} />
        Add Vehicle
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 600 }}>
      <h2 style={{ fontSize: 16, marginBottom: 16 }}>Add a vehicle</h2>

      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Category</span>
        <select name="categoryId" required defaultValue="">
          <option value="" disabled>
            Select a category
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className="form-row">
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Make</span>
          <input name="make" required placeholder="Toyota" />
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Model</span>
          <input name="model" required placeholder="Corolla" />
        </label>
      </div>

      <div className="form-row">
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Year</span>
          <input name="year" type="number" placeholder="2022" />
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Plate</span>
          <input name="plate" />
        </label>
      </div>

      <div className="form-row">
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>VIN</span>
          <input name="vin" />
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Mileage</span>
          <input name="mileage" type="number" placeholder="0" />
        </label>
      </div>

      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

      <div style={{ display: "flex", gap: 10 }}>
        <button type="submit" className="button-primary" disabled={loading}>
          {loading ? "Adding..." : "Add Vehicle"}
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={() => setOpen(false)}
          disabled={loading}
          style={{ color: "var(--text)", borderColor: "var(--border)" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
