"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { saveAdditionalDrivers, type AdditionalDriverInput } from "@/app/apply/actions";

// Reuses the exact same server action the application step uses --
// same validation, same is_primary=false distinction, same replace-the-
// whole-set behavior. This is deliberately the second, ongoing place
// this data can be entered, not a duplicate mechanism: driver
// arrangements genuinely change mid-rental (a new roommate, a partner
// starting to help out), and routing that back through a new
// application would be real, unnecessary friction.
export default function PortalDriversManager({
  customerId,
  initialDrivers,
}: {
  customerId: string;
  initialDrivers: AdditionalDriverInput[];
}) {
  const router = useRouter();
  const [drivers, setDrivers] = useState<AdditionalDriverInput[]>(initialDrivers);
  const [adding, setAdding] = useState(false);
  const [newDriver, setNewDriver] = useState<AdditionalDriverInput>({
    firstName: "",
    lastName: "",
    licenseState: "",
    licenseNumberRef: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!newDriver.firstName.trim() || !newDriver.lastName.trim()) return;
    setError(null);
    setLoading(true);
    const updated = [...drivers, newDriver];
    const result = await saveAdditionalDrivers(customerId, updated);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't save. Please try again.");
      return;
    }
    setDrivers(updated);
    setNewDriver({ firstName: "", lastName: "", licenseState: "", licenseNumberRef: "" });
    setAdding(false);
    router.refresh();
  }

  async function handleRemove(index: number) {
    if (!window.confirm("Remove this driver?")) return;
    const updated = drivers.filter((_, i) => i !== index);
    const result = await saveAdditionalDrivers(customerId, updated);
    if (!result.success) {
      setError(result.error ?? "Couldn't remove that driver.");
      return;
    }
    setDrivers(updated);
    router.refresh();
  }

  return (
    <div>
      {drivers.length === 0 && !adding && (
        <p className="muted-text" style={{ fontSize: 14, marginBottom: 10 }}>
          Just you on the rental right now.
        </p>
      )}
      {drivers.map((d, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, marginBottom: 8 }}>
          <span>
            {d.firstName} {d.lastName}
          </span>
          <button onClick={() => handleRemove(i)} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <Trash2 size={14} color="var(--error, #dc2626)" />
          </button>
        </div>
      ))}

      {error && <p className="error-text" style={{ fontSize: 13, marginBottom: 8 }}>{error}</p>}

      {adding ? (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="form-row">
            <label className="field">
              <span style={{ fontSize: 13, fontWeight: 600 }}>First name</span>
              <input value={newDriver.firstName} onChange={(e) => setNewDriver({ ...newDriver, firstName: e.target.value })} />
            </label>
            <label className="field">
              <span style={{ fontSize: 13, fontWeight: 600 }}>Last name</span>
              <input value={newDriver.lastName} onChange={(e) => setNewDriver({ ...newDriver, lastName: e.target.value })} />
            </label>
          </div>
          <div className="form-row">
            <label className="field">
              <span style={{ fontSize: 13, fontWeight: 600 }}>License state</span>
              <input value={newDriver.licenseState} onChange={(e) => setNewDriver({ ...newDriver, licenseState: e.target.value })} />
            </label>
            <label className="field">
              <span style={{ fontSize: 13, fontWeight: 600 }}>License number</span>
              <input value={newDriver.licenseNumberRef} onChange={(e) => setNewDriver({ ...newDriver, licenseNumberRef: e.target.value })} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleAdd} disabled={loading} className="button-primary">
              {loading ? "Saving..." : "Save Driver"}
            </button>
            <button onClick={() => setAdding(false)} className="button-secondary" style={{ color: "var(--text)", borderColor: "var(--border)" }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="button-secondary"
          style={{ color: "var(--text)", borderColor: "var(--border)", display: "flex", alignItems: "center", gap: 6 }}
        >
          <Plus size={14} /> Add a driver
        </button>
      )}
    </div>
  );
}
