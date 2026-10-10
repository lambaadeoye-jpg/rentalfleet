"use client";

import { useState } from "react";
import { saveWeeklyOfferDay } from "./weekly-offer-actions";

export default function WeeklyOfferForm({ initialDay }: { initialDay: number }) {
  const [day, setDay] = useState(String(initialDay));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    const res = await saveWeeklyOfferDay(Number(day));
    setBusy(false);
    setMsg(res.success ? { ok: true, text: "Saved." } : { ok: false, text: res.error ?? "Couldn’t save." });
  }

  return (
    <div className="card" style={{ maxWidth: 720, marginTop: 28 }}>
      <h2 className="card-title card-title--tight">Weekly plan offer</h2>
      <p className="muted-text" style={{ fontSize: 13, marginBottom: 14 }}>
        Renters on the daily plan are offered the weekly plan once they reach this day of their rental. It applies to
        everyone, so you can run one setting for a while and then another to compare (for example 3 against 7). The
        offer never expires. The text goes out on this day for rentals that start after you save; the portal offer
        changes right away. Each switch records the day that was set, so results can be compared.
      </p>
      <label className="field" style={{ maxWidth: 260 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Offer the weekly plan on day</span>
        <input type="number" min={1} max={30} value={day} onChange={(e) => { setDay(e.target.value); setMsg(null); }} />
      </label>
      <p className="muted-text" style={{ fontSize: 12, marginBottom: 12 }}>A whole number from 1 to 30. Default 3.</p>
      {msg && <p className={msg.ok ? undefined : "error-text"} style={msg.ok ? { color: "var(--signal-green, #16a34a)", fontSize: 14, marginBottom: 8 } : { marginBottom: 8 }}>{msg.text}</p>}
      <button className="button-primary" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</button>
    </div>
  );
}
