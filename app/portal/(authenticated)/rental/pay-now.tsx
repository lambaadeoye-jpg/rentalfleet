"use client";

import { useState } from "react";
import { startMyPayment } from "./payment-actions";

export default function PayNow({ label = "Pay now" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true); setError(null);
    try {
      const res = await startMyPayment();
      if (!res.success || !res.url) { setError(res.error ?? "Couldn’t start payment."); setBusy(false); return; }
      window.location.href = res.url;
    } catch {
      setError("Couldn’t start payment. Please try again.");
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="button-primary" disabled={busy} onClick={go}>{busy ? "Opening..." : label}</button>
      {error && <p className="error-text" style={{ marginTop: 8, fontSize: 13 }}>{error}</p>}
    </div>
  );
}
