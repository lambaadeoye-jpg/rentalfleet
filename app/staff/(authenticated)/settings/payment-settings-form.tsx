"use client";

import { useState } from "react";
import { savePaymentSettings, type PaymentSettings } from "./payment-settings-actions";

export default function PaymentSettingsForm({ initial }: { initial: PaymentSettings }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [slotPay, setSlotPay] = useState(initial.slotRequiresPayment);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true); setMsg(null);
    const res = await savePaymentSettings(enabled, slotPay);
    setBusy(false);
    setMsg(res.success ? { ok: true, text: "Saved." } : { ok: false, text: res.error ?? "Couldn't save." });
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, marginBottom: 6 }}>Card payments</h2>
      <p className="muted-text" style={{ fontSize: 13, marginBottom: 12 }}>
        {initial.stripeReady
          ? "Stripe is connected. Renters pay the first week plus deposit on a secure Stripe page; their card is saved for weekly rent."
          : "Stripe isn't connected yet. Add the Stripe keys in Netlify, then come back and switch this on."}
      </p>
      <label className="checkbox-item" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); if (!e.target.checked) setSlotPay(false); }} />
        Accept card payments (payment links work only while this is on)
      </label>
      <label className="checkbox-item" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={slotPay} disabled={!enabled} onChange={(e) => setSlotPay(e.target.checked)} />
        A pickup time is only confirmed once the renter has paid
      </label>
      <p className="muted-text" style={{ fontSize: 12, marginBottom: 10 }}>
        The agreement must be signed before a payment link can be created{initial.requireSignature ? "" : " (currently not required)"}.
        Turning this off stops all payment links immediately.
      </p>
      <button className="button-primary" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button>
      {msg && <p className={msg.ok ? "muted-text" : "error-text"} style={{ marginTop: 8 }}>{msg.text}</p>}
    </div>
  );
}
