"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { previewStaffCancellation, confirmStaffCancellation } from "../cancel-actions";
import { REASON_LABELS, settlementSummary, type Settlement } from "@/lib/refunds";

const REASONS = ["renter_cancelled", "no_show", "requirement_failed", "zivo_cancelled", "fraud_or_identity"] as const;
const HELP: Record<string, string> = {
  renter_cancelled: "The renter asked to cancel. The fee depends on how close to pickup it is and their recent cancellations.",
  no_show: "The renter didn’t arrive after the grace period. The late fee is kept and the rest is refunded. To let them reschedule instead, do not cancel: use Resolve on the Pickups screen.",
  requirement_failed: "They couldn’t meet a stated requirement at pickup (valid license, a card in their own name, required documents).",
  zivo_cancelled: "Zivo’s error or no car ready. No fee, full refund.",
  fraud_or_identity: "A fraud or identity problem found before pickup. No fee, full refund.",
};

export default function CancelCard({ rentalId }: { rentalId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("renter_cancelled");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Settlement | null>(null);
  const [done, setDone] = useState<{ s: Settlement; sendNote?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doPreview(r = reason) {
    setBusy(true); setError(null);
    const res = await previewStaffCancellation(rentalId, r);
    setBusy(false);
    if (!res.success) { setError(res.error); setPreview(null); } else setPreview(res.settlement);
  }
  async function confirm() {
    setBusy(true); setError(null);
    const res = await confirmStaffCancellation(rentalId, reason, note);
    setBusy(false);
    if (!res.success) { setError(res.error); return; }
    setDone({ s: res.settlement, sendNote: res.sendNote });
    router.refresh();
  }

  if (done) {
    return (
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Rental cancelled</h2>
        <p style={{ fontSize: 14 }}>{settlementSummary(done.s)}</p>
        {done.s.status === "pending_approval" && <p className="muted-text" style={{ fontSize: 13, marginTop: 6 }}>The refund is waiting for approval on the <Link href="/staff/refunds" style={{ color: "var(--teal)" }}>Refunds</Link> page.</p>}
        {!done.s.vehicleReleased && <p className="error-text" style={{ fontSize: 13, marginTop: 6 }}>The vehicle is still marked reserved. Someone with fleet permission needs to set it back to available.</p>}
        {done.sendNote && <p className="error-text" style={{ fontSize: 13, marginTop: 6 }}>{done.sendNote}</p>}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Cancel before pickup</h2>
      {!open ? (
        <button className="button-secondary" onClick={() => setOpen(true)}>Cancel this rental</button>
      ) : (
        <>
          <div className="field" style={{ maxWidth: 360 }}>
            <label htmlFor="cancel-reason">Reason</label>
            <select id="cancel-reason" value={reason} onChange={(e) => { setReason(e.target.value); setPreview(null); }}>
              {REASONS.map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
            </select>
          </div>
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>{HELP[reason]}</p>
          <div className="field">
            <label htmlFor="cancel-note">Note (optional)</label>
            <input id="cancel-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
          {!preview ? (
            <button className="button-primary" disabled={busy} onClick={() => doPreview()}>{busy ? "Calculating..." : "Show refund"}</button>
          ) : (
            <>
              <div style={{ background: "var(--surface-2, rgba(0,0,0,0.04))", padding: 12, borderRadius: 8, marginBottom: 10 }}>
                <p style={{ fontSize: 14 }}>{settlementSummary(preview)}</p>
                {preview.manualCents > 0 && <p style={{ fontSize: 13, marginTop: 6 }}>${(preview.manualCents / 100).toFixed(2)} was not paid by card and will need a manual refund.</p>}
                {preview.needsAdmin && <p style={{ fontSize: 13, marginTop: 6 }}>Over the approval limit: an admin must approve the refund.</p>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="button-primary" disabled={busy} onClick={confirm}>{busy ? "Cancelling..." : "Confirm cancellation"}</button>
                <button className="button-secondary" disabled={busy} onClick={() => setPreview(null)}>Back</button>
              </div>
            </>
          )}
          {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
        </>
      )}
    </div>
  );
}
