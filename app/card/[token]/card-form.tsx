"use client";

import { useState } from "react";
import { startCardUpdate } from "./actions";

export default function CardForm({ token, authorization }: { token: string; authorization: string }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!ok) { setError("Please tick the box to confirm."); return; }
    setBusy(true);
    try {
      const res = await startCardUpdate(token, ok);
      if (!res.success) { setError(res.error); setBusy(false); return; }
      window.location.href = res.url;
    } catch {
      setError("We couldn’t open the card page. Please try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <label className="checkbox-item" style={{ alignItems: "flex-start", marginBottom: 14, fontSize: 14 }}>
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ marginTop: 3 }} />
        <span>{authorization}</span>
      </label>
      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
      <button type="button" className="button-primary" disabled={busy} onClick={save} style={{ width: "100%" }}>
        {busy ? "Opening secure page..." : "Add my new card"}
      </button>
      <p className="muted-text" style={{ textAlign: "center", marginTop: 10, fontSize: 13 }}>
        Cards are handled by Stripe. Zivo never sees your card number.
      </p>
    </>
  );
}
