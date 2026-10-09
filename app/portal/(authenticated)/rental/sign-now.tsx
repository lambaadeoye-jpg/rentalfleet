"use client";

import { useState } from "react";
import { startMySigning } from "./payment-actions";

export default function SignNow() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true); setError(null);
    try {
      const res = await startMySigning();
      if (!res.success || !res.url) { setError(res.error ?? "Couldn’t open your agreement."); setBusy(false); return; }
      window.location.href = res.url;
    } catch {
      setError("Couldn’t open your agreement. Please try again.");
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="button-primary" disabled={busy} onClick={go}>{busy ? "Opening..." : "Review and sign agreement"}</button>
      {error && <p className="error-text" style={{ marginTop: 8, fontSize: 13 }}>{error}</p>}
    </div>
  );
}
