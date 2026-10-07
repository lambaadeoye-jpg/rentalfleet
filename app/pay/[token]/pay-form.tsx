"use client";

import { useState } from "react";
import { startCheckout } from "./actions";

export default function PayForm({ token, terms, totalLabel }: { token: string; terms: string[]; totalLabel: string }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setError(null);
    if (!ok) { setError("Please tick the box to confirm you’ve read the cancellation and refund terms."); return; }
    setBusy(true);
    try {
      const res = await startCheckout(token, ok);
      if (!res.success) { setError(res.error); setBusy(false); return; }
      window.location.href = res.url;
    } catch {
      setError("We couldn’t start the payment. Please try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Cancellation and refund terms</h2>
        <ul style={{ paddingLeft: 18, fontSize: 14, lineHeight: 1.5 }}>
          {terms.map((t, i) => <li key={i} style={{ marginBottom: 6 }}>{t}</li>)}
        </ul>
      </div>
      <label className="checkbox-item" style={{ alignItems: "flex-start", marginBottom: 14, fontSize: 14 }}>
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I have read and agree to the cancellation and refund terms above.</span>
      </label>
      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
      <button type="button" className="button-primary" disabled={busy} onClick={pay} style={{ width: "100%" }}>
        {busy ? "Opening secure payment..." : `Pay ${totalLabel} by card`}
      </button>
      <p className="muted-text" style={{ textAlign: "center", marginTop: 10, fontSize: 13 }}>
        Card payments are processed by Stripe. Your card is saved for your weekly rent charges. Zivo never sees your card number.
      </p>
    </>
  );
}
