"use client";

import { useState } from "react";
import { updateMyStaffProfile, setMyStaffPassword } from "./actions";

export default function StaffProfileForm({
  initialFullName,
  email,
  isAdmin,
}: {
  initialFullName: string;
  email: string;
  isAdmin: boolean;
}) {
  const [fullName, setFullName] = useState(initialFullName);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [password, setPassword] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

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

  async function handleSetPassword() {
    setPasswordError(null);
    setPasswordSaved(false);
    setPasswordLoading(true);
    const result = await setMyStaffPassword(password);
    setPasswordLoading(false);

    if (!result.success) {
      setPasswordError(result.error ?? "Couldn't set password. Please try again.");
      return;
    }
    setPassword("");
    setPasswordSaved(true);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
      <div className="card">
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

      {isAdmin && (
        <div className="card">
          <h2 style={{ fontSize: 15, marginBottom: 4 }}>Password sign-in (optional)</h2>
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 16 }}>
            Purely optional convenience -- the sign-in link by email always works regardless,
            whether or not you set a password here.
          </p>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>New password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
          </label>

          {passwordError && <p className="error-text" style={{ marginBottom: 12 }}>{passwordError}</p>}
          {passwordSaved && (
            <p style={{ color: "var(--signal-green, #16a34a)", fontSize: 14, marginBottom: 12 }}>
              Password set. You can now sign in with it, or keep using the email link -- both work.
            </p>
          )}

          <button onClick={handleSetPassword} disabled={passwordLoading || !password} className="button-secondary" style={{ color: "var(--text)", borderColor: "var(--border)" }}>
            {passwordLoading ? "Setting..." : "Set Password"}
          </button>
        </div>
      )}
    </div>
  );
}
