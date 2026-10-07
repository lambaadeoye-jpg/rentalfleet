"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { previewDepositReturn, confirmDepositReturn } from "../deposit-actions";
import { depositReturnSummary, type DepositReturn } from "@/lib/refunds";

export default function DepositCard({ rentalId }: { rentalId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<DepositReturn | null>(null);
  const [done, setDone] = useState<{ d: DepositReturn; sendNote?: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doPreview() {
    setBusy(true); setError(null);
    const res = await previewDepositReturn(rentalId);
    setBusy(false);
    if (!res.success) { setError(res.error); setPreview(null); } else setPreview(res.deposit);
  }
  async function confirm() {
    setBusy(true); setError(null);
    const res = await confirmDepositReturn(rentalId, note);
    setBusy(false);
    if (!res.success) { setError(res.error); return; }
    setDone({ d: res.deposit, sendNote: res.sendNote });
    router.refresh();
  }

  if (done) {
    return (
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Deposit settled</h2>
        <p style={{ fontSize: 14 }}>{depositReturnSummary(done.d)}</p>
        {done.d.status === "pending_approval" && (
          <p className="muted-text" style={{ fontSize: 13, marginTop: 6 }}>This is over the approval limit. An admin needs to approve it on the <Link href="/staff/refunds" style={{ color: "var(--teal)" }}>Refunds</Link> page.</p>
        )}
        {done.d.manualCents > 0 && <p style={{ fontSize: 13, marginTop: 6 }}>${(done.d.manualCents / 100).toFixed(2)} was not paid by card and needs a manual refund (Refunds page).</p>}
        {done.sendNote && <p className="error-text" style={{ fontSize: 13, marginTop: 6 }}>{done.sendNote}</p>}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Return the deposit</h2>
      <p className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>
        The vehicle has been returned. Returning the deposit sends back what is still refundable after any approved deductions.
        Approve or reject any pending charges first.
      </p>
      {!preview ? (
        <button className="button-primary" disabled={busy} onClick={doPreview}>{busy ? "Calculating..." : "Show deposit return"}</button>
      ) : (
        <>
          <div style={{ background: "var(--surface-2, rgba(0,0,0,0.04))", padding: 12, borderRadius: 8, marginBottom: 10 }}>
            <p style={{ fontSize: 14 }}>{depositReturnSummary(preview)}</p>
            {preview.manualCents > 0 && <p style={{ fontSize: 13, marginTop: 6 }}>${(preview.manualCents / 100).toFixed(2)} was not paid by card and will need a manual refund.</p>}
            {preview.needsAdmin && <p style={{ fontSize: 13, marginTop: 6 }}>Over the approval limit: an admin must approve it.</p>}
          </div>
          <div className="field">
            <label htmlFor="deposit-note">Note (optional)</label>
            <input id="deposit-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="button-primary" disabled={busy} onClick={confirm}>{busy ? "Working..." : "Confirm deposit return"}</button>
            <button className="button-secondary" disabled={busy} onClick={() => setPreview(null)}>Back</button>
          </div>
        </>
      )}
      {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
