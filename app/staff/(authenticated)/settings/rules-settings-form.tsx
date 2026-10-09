"use client";

import { useState } from "react";
import { saveRulesSettings, type RulesSettings } from "./rules-settings-actions";

export default function RulesSettingsForm({ initial }: { initial: RulesSettings }) {
  const [v, setV] = useState({
    ticketPayHours: initial.ticketPayHours, ticketReviewThreshold: initial.ticketReviewThreshold, maintenanceDays: initial.maintenanceDays,
    instagram: initial.instagram, insuranceLine: initial.insuranceLine,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setV({ ...v, [k]: e.target.value }); setSaved(false); };

  async function save() {
    setLoading(true); setError(null); setSaved(false);
    const res = await saveRulesSettings(v);
    setLoading(false);
    if (!res.success) setError(res.error ?? "Couldn’t save.");
    else setSaved(true);
  }

  return (
    <div className="card" style={{ maxWidth: 560, marginTop: 28 }}>
      <h2 className="card-title card-title--tight">Rental rules</h2>
      <p className="muted-text" style={{ fontSize: 13, marginBottom: 12 }}>
        What runners explain at pickup and what renters are sent afterwards. Fees and limits below come from the approved
        agreement, so they always match what the renter signed. Change them in the agreement.
      </p>
      <ul style={{ margin: "0 0 16px", paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
        {initial.fromAgreement.map((f) => <li key={f.label}><b>{f.label}:</b> {f.value}</li>)}
      </ul>

      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Pay tickets within (hours)</span>
        <input inputMode="numeric" value={v.ticketPayHours} onChange={set("ticketPayHours")} />
      </label>
      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Flag a renter for review after more than (tickets)</span>
        <input inputMode="numeric" value={v.ticketReviewThreshold} onChange={set("ticketReviewThreshold")} />
      </label>
      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Service each car about every (days)</span>
        <input inputMode="numeric" value={v.maintenanceDays} onChange={set("maintenanceDays")} />
      </label>
      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Instagram handle</span>
        <input value={v.instagram} onChange={set("instagram")} placeholder="@rentzivo" />
      </label>
      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Insurance line (read to the renter at pickup)</span>
        <textarea rows={3} value={v.insuranceLine} onChange={set("insuranceLine")} />
      </label>
      <p className="muted-text" style={{ fontSize: 12, marginBottom: 16 }}>
        Make sure this matches the insurance wording on your website and in the agreement.
      </p>

      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
      {saved && <p style={{ color: "var(--signal-green, #16a34a)", fontSize: 14, marginBottom: 12 }}>Saved.</p>}
      <button onClick={save} disabled={loading} className="button-primary">{loading ? "Saving..." : "Save rental rules"}</button>
    </div>
  );
}
