"use client";

import { useState } from "react";
import { createMyCardLink } from "./card-actions";

export default function UpdateCardButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true); setError(null);
    try {
      const res = await createMyCardLink();
      if (!res.success) { setError(res.error); setBusy(false); return; }
      window.location.href = res.url;
    } catch {
      setError("We couldn’t start that. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Payment card</h2>
      <p className="muted-text" style={{ fontSize: 14, marginBottom: 10 }}>
        Your weekly rent is charged to the card we have on file. Add a new card here if it changed or was declined.
      </p>
      {error && <p className="error-text" style={{ marginBottom: 8 }}>{error}</p>}
      <button type="button" className="button-secondary" disabled={busy} onClick={go}>
        {busy ? "Opening..." : "Update my card"}
      </button>
    </div>
  );
}
