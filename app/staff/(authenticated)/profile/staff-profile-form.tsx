"use client";

import { useState } from "react";
import { updateMyStaffProfile } from "./actions";

export default function StaffProfileForm({ initialFullName, email }: { initialFullName: string; email: string }) {
  const [fullName, setFullName] = useState(initialFullName);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setError(null);
    setSaved(false);
    setLoading(true);
    const result = await updateMyStaffProfile(fullName);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't save. Please try again.");
      return;
    }
    setSaved(true);
  }

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Full name</span>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>
      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Email</span>
        <input value={email} disabled style={{ opacity: 0.6 }} />
      </label>

      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
      {saved && <p style={{ color: "var(--signal-green, #16a34a)", fontSize: 14, marginBottom: 12 }}>Saved.</p>}

      <button onClick={handleSave} disabled={loading} className="button-primary">
        {loading ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
