"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addLocation, toggleLocationActive, type PickupLocation } from "./actions";

export default function LocationList({ initialLocations }: { initialLocations: PickupLocation[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    setError(null);
    setLoading(true);
    const result = await addLocation(name, addressLine1, city, state);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't add that location.");
      return;
    }
    setName("");
    setAddressLine1("");
    setCity("");
    setState("");
    router.refresh();
  }

  async function handleToggle(locationId: string, active: boolean) {
    await toggleLocationActive(locationId, !active);
    router.refresh();
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Add a location</h2>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nashville Main" />
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Address</span>
          <input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
        </label>
        <div className="form-row">
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>City</span>
            <input value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>State</span>
            <input value={state} onChange={(e) => setState(e.target.value)} maxLength={2} placeholder="TN" />
          </label>
        </div>
        {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
        <button onClick={handleAdd} disabled={loading} className="button-primary">
          {loading ? "Adding..." : "Add Location"}
        </button>
      </div>

      {initialLocations.map((l) => (
        <div key={l.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700 }}>{l.name}</div>
            <div className="muted-text" style={{ fontSize: 13 }}>
              {[l.addressLine1, l.city, l.state].filter(Boolean).join(", ") || "No address on file"}
            </div>
          </div>
          <button
            onClick={() => handleToggle(l.id, l.active)}
            className="button-secondary"
            style={{ color: l.active ? "var(--red, #dc2626)" : "var(--signal-green, #16a34a)", borderColor: "var(--border)" }}
          >
            {l.active ? "Deactivate" : "Activate"}
          </button>
        </div>
      ))}
    </div>
  );
}
