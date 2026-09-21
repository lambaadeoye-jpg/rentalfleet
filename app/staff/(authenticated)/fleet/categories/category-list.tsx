"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addVehicleCategory, toggleVehicleCategoryActive, type VehicleCategory } from "./actions";

export default function CategoryList({ initialCategories }: { initialCategories: VehicleCategory[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    setError(null);
    setLoading(true);
    const result = await addVehicleCategory(name, description);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't add that category.");
      return;
    }
    setName("");
    setDescription("");
    router.refresh();
  }

  async function handleToggle(categoryId: string, active: boolean) {
    await toggleVehicleCategoryActive(categoryId, !active);
    router.refresh();
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Add a category</h2>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SUV, Compact" />
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Description (optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
        <button onClick={handleAdd} disabled={loading} className="button-primary">
          {loading ? "Adding..." : "Add Category"}
        </button>
      </div>

      {initialCategories.map((c) => (
        <div key={c.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700 }}>{c.name}</div>
            {c.description && <div className="muted-text" style={{ fontSize: 13 }}>{c.description}</div>}
          </div>
          <button
            onClick={() => handleToggle(c.id, c.active)}
            className="button-secondary"
            style={{ color: c.active ? "var(--red, #dc2626)" : "var(--signal-green, #16a34a)", borderColor: "var(--border)" }}
          >
            {c.active ? "Deactivate" : "Activate"}
          </button>
        </div>
      ))}
    </div>
  );
}
