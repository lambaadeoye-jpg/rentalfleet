"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { groupSlotsByDay, formatSlotTime, type Slot } from "@/lib/pickup-slots";
import { listPickupSlots, bookPickupSlot, cancelPendingHold, type PickerState } from "./pickup-actions";

export default function PickupSlotPicker({ state }: { state: PickerState }) {
  const router = useRouter();
  const [changing, setChanging] = useState(false);
  const [locationId, setLocationId] = useState(state.locations[0]?.id ?? "");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const location = state.locations.find((l) => l.id === locationId) ?? state.locations[0];
  const tz = location?.timezone ?? "America/Chicago";
  const days = useMemo(() => groupSlotsByDay(slots ?? [], tz), [slots, tz]);
  const showPicker = state.canPick && (changing || (!state.current && !state.pending));

  useEffect(() => {
    if (!showPicker || !locationId) return;
    let cancelled = false;
    setSlots(null);
    setError(null);
    listPickupSlots(locationId).then((res) => {
      if (cancelled) return;
      if (!res.success) {
        setError(res.error ?? "Something went wrong. Please try again.");
        setSlots([]);
        return;
      }
      setSlots(res.slots);
      const first = groupSlotsByDay(res.slots, tz)[0];
      setDayKey(first?.dayKey ?? null);
    });
    return () => { cancelled = true; };
  }, [showPicker, locationId, tz]);

  if (!state.enabled) return null;

  async function pick(startsAt: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await bookPickupSlot(locationId, startsAt);
    setBusy(false);
    if (!res.success) {
      setError(res.error ?? "Something went wrong. Please try again.");
      // The slot may have just been taken; refresh the list.
      const refreshed = await listPickupSlots(locationId);
      if (refreshed.success) setSlots(refreshed.slots);
      return;
    }
    setChanging(false);
    setNotice(res.status === "held" ? "We're holding that time for you. Payment locks it in." : "Your pickup time is booked.");
    router.refresh();
  }

  async function release(holdId: string) {
    setBusy(true);
    const res = await cancelPendingHold(holdId);
    setBusy(false);
    if (!res.success) { setError(res.error ?? "Something went wrong."); return; }
    router.refresh();
  }

  const activeDay = days.find((d) => d.dayKey === dayKey) ?? days[0];

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <CalendarClock size={20} color="var(--teal)" />
        <h2 style={{ fontSize: 14, fontWeight: 700 }}>Pickup time</h2>
      </div>

      {notice && <p style={{ color: "var(--signal-green, #16a34a)", fontSize: 14, marginBottom: 10 }}>{notice}</p>}

      {state.current && !changing && (
        <>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{formatSlotTime(state.current.startsAt, state.current.timezone)}</p>
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 12 }}>{state.current.locationName}</p>
          {state.canPick && (
            <button className="button-secondary" onClick={() => setChanging(true)}>Change time</button>
          )}
        </>
      )}

      {state.pending && !changing && (
        <>
          <p style={{ fontSize: 14, marginBottom: 6 }}>
            Holding <strong>{formatSlotTime(state.pending.startsAt, state.pending.timezone)}</strong> at {state.pending.locationName} until{" "}
            {new Date(state.pending.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="button-secondary" disabled={busy} onClick={() => release(state.pending!.holdId)}>Release this time</button>
          </div>
        </>
      )}

      {showPicker && (
        <>
          {state.locations.length > 1 && (
            <div className="field">
              <label htmlFor="pickup-location">Location</label>
              <select id="pickup-location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {state.locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          )}
          {location && <p className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>{location.name}{location.address ? ` — ${location.address}` : ""}</p>}

          {slots === null && <p className="muted-text" style={{ fontSize: 14 }}>Loading times…</p>}
          {slots !== null && days.length === 0 && !error && (
            <p className="muted-text" style={{ fontSize: 14 }}>No times are open right now. We&apos;ll reach out to set one with you.</p>
          )}

          {days.length > 0 && (
            <>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 10 }}>
                {days.map((d) => (
                  <button
                    key={d.dayKey}
                    type="button"
                    onClick={() => setDayKey(d.dayKey)}
                    className={d.dayKey === activeDay?.dayKey ? "button-primary" : "button-secondary"}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
                {activeDay?.slots.map((s) => (
                  <button key={s.startsAt} type="button" className="button-secondary" disabled={busy} onClick={() => pick(s.startsAt)}>
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="muted-text" style={{ fontSize: 12, marginTop: 10 }}>
                Times are in {tz.replace("_", " ").split("/").pop()} time. Tap a time to book it.
              </p>
            </>
          )}
          {changing && (
            <button className="button-secondary" style={{ marginTop: 10 }} onClick={() => setChanging(false)}>Keep my current time</button>
          )}
        </>
      )}

      {!state.canPick && !state.current && !state.pending && (
        <p className="muted-text" style={{ fontSize: 14 }}>We&apos;ll let you know here when it&apos;s time to choose a pickup time.</p>
      )}

      {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  );
}
