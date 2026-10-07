"use client";

import { useState } from "react";
import { WEEKDAYS, SLOT_MINUTE_OPTIONS, type WeeklyRuleInput } from "@/lib/pickup-slots";
import { savePickupSettings, saveLocationHours, type PickupScheduling } from "./pickup-actions";

function LocationHoursEditor({ locationId, name, initial }: { locationId: string; name: string; initial: WeeklyRuleInput[] }) {
  const [week, setWeek] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function patch(i: number, p: Partial<WeeklyRuleInput>) {
    setWeek((w) => w.map((d, idx) => (idx === i ? { ...d, ...p } : d)));
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    const res = await saveLocationHours(locationId, week);
    setBusy(false);
    setMsg(res.success ? { ok: true, text: "Saved." } : { ok: false, text: res.error ?? "Couldn’t save." });
  }

  return (
    <div style={{ marginTop: 20 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{name}</h3>
      {week.map((d, i) => (
        <div key={d.weekday} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <label className="checkbox-item" style={{ width: 120 }}>
            <input type="checkbox" checked={d.open} onChange={(e) => patch(i, { open: e.target.checked })} />
            {WEEKDAYS[d.weekday]}
          </label>
          {d.open ? (
            <>
              <input type="time" value={d.startTime} onChange={(e) => patch(i, { startTime: e.target.value })} aria-label={`${WEEKDAYS[d.weekday]} opens`} style={{ width: 120 }} />
              <span>to</span>
              <input type="time" value={d.endTime} onChange={(e) => patch(i, { endTime: e.target.value })} aria-label={`${WEEKDAYS[d.weekday]} closes`} style={{ width: 120 }} />
              <select value={d.slotMinutes} onChange={(e) => patch(i, { slotMinutes: Number(e.target.value) })} aria-label="Slot length" style={{ width: 110 }}>
                {SLOT_MINUTE_OPTIONS.map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
              <input type="number" min={1} max={20} value={d.capacity} onChange={(e) => patch(i, { capacity: Number(e.target.value) })} aria-label="Pickups per slot" style={{ width: 70 }} />
              <span className="muted-text" style={{ fontSize: 12 }}>at once</span>
            </>
          ) : (
            <span className="muted-text" style={{ fontSize: 13 }}>Closed</span>
          )}
        </div>
      ))}
      {msg && <p className={msg.ok ? undefined : "error-text"} style={msg.ok ? { color: "var(--signal-green, #16a34a)", fontSize: 14 } : undefined}>{msg.text}</p>}
      <button className="button-primary" onClick={save} disabled={busy} style={{ marginTop: 6 }}>
        {busy ? "Saving..." : "Save hours"}
      </button>
    </div>
  );
}

export default function PickupSchedulingForm({ initial }: { initial: PickupScheduling }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [hold, setHold] = useState(initial.holdMinutes);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await savePickupSettings(enabled, hold);
    setBusy(false);
    setMsg(res.success ? { ok: true, text: "Saved." } : { ok: false, text: res.error ?? "Couldn’t save." });
  }

  return (
    <div className="card" style={{ maxWidth: 720, marginTop: 28 }}>
      <h2 className="card-title card-title--tight">Pickup scheduling</h2>
      <p className="muted-text" style={{ fontSize: 13, marginBottom: 14 }}>
        When on, a renter whose rental is scheduled can pick their own pickup time from the hours below.
        Turn it off any time and renters see nothing; times already booked stay booked.
      </p>

      <label className="checkbox-item" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setMsg(null); }} />
        Let renters pick their own pickup time
      </label>

      <label className="field" style={{ maxWidth: 260 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Hold a chosen time for (minutes)</span>
        <input type="number" min={5} max={240} value={hold} onChange={(e) => { setHold(Number(e.target.value)); setMsg(null); }} />
      </label>
      <p className="muted-text" style={{ fontSize: 12, marginBottom: 12 }}>
        Used when payment is needed to lock a time in. Between 5 and 240.
      </p>

      {msg && <p className={msg.ok ? undefined : "error-text"} style={msg.ok ? { color: "var(--signal-green, #16a34a)", fontSize: 14, marginBottom: 8 } : { marginBottom: 8 }}>{msg.text}</p>}
      <button className="button-primary" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</button>

      <hr style={{ margin: "24px 0 4px", opacity: 0.2 }} />
      <h3 style={{ fontSize: 15, marginTop: 16 }}>Weekly pickup hours</h3>
      <p className="muted-text" style={{ fontSize: 12 }}>
        &ldquo;At once&rdquo; is how many pickups your team can hand over in the same time slot. Times are in each location&rsquo;s time zone.
      </p>
      {initial.locations.length === 0 && <p className="muted-text">Add a location first.</p>}
      {initial.locations.map((l) => (
        <LocationHoursEditor key={l.locationId} locationId={l.locationId} name={l.name} initial={l.rules} />
      ))}
    </div>
  );
}
