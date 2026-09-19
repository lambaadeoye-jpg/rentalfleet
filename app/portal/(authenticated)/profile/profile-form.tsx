"use client";

import { useState } from "react";
import { updateProfile } from "../../actions";

export default function ProfileForm({
  initialFirstName,
  initialLastName,
  initialPhone,
  email,
}: {
  initialFirstName: string;
  initialLastName: string;
  initialPhone: string;
  email: string;
}) {
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [phone, setPhone] = useState(initialPhone);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setError(null);
    setSaved(false);
    setLoading(true);
    const result = await updateProfile({ firstName, lastName, phone });
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't save. Please try again.");
      return;
    }
    setSaved(true);
  }

  return (
    <div className="card">
      <div className="form-row">
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>First name</span>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Last name</span>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Phone</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" />
      </label>
      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Email</span>
        <input value={email} disabled style={{ opacity: 0.6 }} />
      </label>

      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
      {saved && <p style={{ color: "var(--signal-green, #16a34a)", fontSize: 13, marginBottom: 12 }}>Saved.</p>}

      <button onClick={handleSave} disabled={loading} className="button-primary">
        {loading ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}
