"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addToDoNotRent, liftDoNotRent, type ActiveBan } from "../ban-actions";

export default function BanCard({ customerId, bans }: { customerId: string; bans: ActiveBan[] }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true); setError(null);
    const res = await addToDoNotRent(customerId, reason);
    setBusy(false);
    if (!res.success) { setError(res.error ?? "Couldn’t save."); return; }
    setReason(""); setOpen(false); router.refresh();
  }
  async function lift(id: string) {
    if (!window.confirm("Remove this person from the do-not-rent list?")) return;
    setBusy(true); setError(null);
    const res = await liftDoNotRent(id);
    setBusy(false);
    if (!res.success) { setError(res.error ?? "Couldn’t save."); return; }
    router.refresh();
  }

  return (
    <div className="card" style={{ marginBottom: 24, borderColor: bans.length ? "#fca5a5" : undefined }}>
      <h2 className="card-title">Do-not-rent list</h2>
      {bans.length > 0 ? (
        <>
          <p style={{ fontWeight: 700, color: "#b91c1c", marginBottom: 6 }}>On the do-not-rent list. New applications are blocked.</p>
          {bans.map((b) => (
            <div key={b.id} style={{ marginBottom: 8, fontSize: 14 }}>
              <div>{b.reason} <span className="muted-text">({new Date(b.createdAt).toLocaleDateString()})</span></div>
              <button type="button" className="link-button" disabled={busy} onClick={() => lift(b.id)}>Remove from list</button>
            </div>
          ))}
        </>
      ) : open ? (
        <>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Reason (kept on record)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </label>
          <p className="muted-text" style={{ fontSize: 12, marginBottom: 8 }}>Blocks any new application using this phone number or email. Check your agreement and local law first.</p>
          <div className="row-actions">
            <button type="button" className="button-primary" disabled={busy} onClick={add}>{busy ? "Saving…" : "Add to list"}</button>
            <button type="button" className="link-button" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <button type="button" className="link-button" onClick={() => setOpen(true)}>Add to do-not-rent list…</button>
      )}
      {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
