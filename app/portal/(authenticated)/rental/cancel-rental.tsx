"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { previewMyCancellation, cancelMyRental } from "./cancel-actions";
import { settlementSummary, type Settlement } from "@/lib/refunds";

export default function CancelRental() {
  const router = useRouter();
  const [preview, setPreview] = useState<Settlement | null>(null);
  const [done, setDone] = useState<Settlement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true); setError(null);
    const res = await previewMyCancellation();
    setBusy(false);
    if (!res.success) setError(res.error); else setPreview(res.settlement);
  }
  async function confirm() {
    setBusy(true); setError(null);
    const res = await cancelMyRental();
    setBusy(false);
    if (!res.success) { setError(res.error); return; }
    setDone(res.settlement); setPreview(null);
    router.refresh();
  }

  if (done) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 className="card-title card-title--tight">Your rental is cancelled</h2>
        <p style={{ fontSize: 14 }}>{settlementSummary(done)}</p>
        {done.totalRefundCents > 0 && (
          <p className="muted-text" style={{ fontSize: 13, marginTop: 6 }}>
            {done.status === "approved"
              ? "Your refund is on its way. It usually shows on your card in 5 to 10 business days."
              : "Our team reviews refunds, usually within one business day. After that it takes 5 to 10 business days to show on your card."}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 className="card-title card-title--tight">Need to cancel?</h2>
      {!preview ? (
        <>
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>See exactly what you&rsquo;d get back before you decide.</p>
          <button className="button-secondary" disabled={busy} onClick={start}>{busy ? "Checking..." : "See what I get back"}</button>
        </>
      ) : (
        <>
          <p style={{ fontSize: 14, marginBottom: 10 }}>{settlementSummary(preview)}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="button-primary" disabled={busy} onClick={confirm}>{busy ? "Cancelling..." : "Yes, cancel my rental"}</button>
            <button className="button-secondary" disabled={busy} onClick={() => setPreview(null)}>Keep my rental</button>
          </div>
        </>
      )}
      {error && <p className="error-text" style={{ marginTop: 8, fontSize: 13 }}>{error}</p>}
    </div>
  );
}
