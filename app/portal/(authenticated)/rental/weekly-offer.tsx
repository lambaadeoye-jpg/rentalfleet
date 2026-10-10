"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { switchMyPlanToWeekly } from "./payment-actions";
import { createMyCardLink } from "../money/card-actions";

type Props = { rate: number; firstChargeAt: string; cardLast4: string | null; needsCard: boolean; consent: string };

const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "")}`;

export default function WeeklyOffer({ rate, firstChargeAt, cardLast4, needsCard, consent }: Props) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = new Date(firstChargeAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

  async function addCard() {
    setBusy(true); setError(null);
    try {
      const res = await createMyCardLink();
      if (!res.success) { setError(res.error); setBusy(false); return; }
      window.location.href = res.url;
    } catch { setError("We couldn’t start that. Please try again."); setBusy(false); }
  }

  async function go() {
    setBusy(true); setError(null);
    try {
      const res = await switchMyPlanToWeekly(agreed);
      if (!res.success) { setError(res.error ?? "We couldn’t switch your plan."); setBusy(false); return; }
      router.refresh();
    } catch { setError("We couldn’t switch your plan. Please try again."); setBusy(false); }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 className="card-title card-title--tight">Switch to the weekly plan</h2>
      <p style={{ fontSize: 14, marginBottom: 6 }}>
        <strong>{money(rate)} per week</strong>, charged automatically. Your first week is already paid. The first weekly charge is {first}.
      </p>
      <p className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>
        Your deposit and the 7-day minimum stay the same. You can return the car any time after the minimum.
      </p>
      {needsCard ? (
        <>
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>The weekly plan is charged to a card on file. Add your card first, then come back here to switch.</p>
          <button type="button" className="button-primary" disabled={busy} onClick={addCard}>{busy ? "Opening..." : "Add my card"}</button>
        </>
      ) : (
        <>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginBottom: 10 }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
            <span>{consent}</span>
          </label>
          <button type="button" className="button-primary" disabled={busy || !agreed} onClick={go}>
            {busy ? "Switching..." : `Switch to weekly${cardLast4 ? ` (card ending ${cardLast4})` : ""}`}
          </button>
        </>
      )}
      {error && <p className="error-text" style={{ marginTop: 8, fontSize: 13 }}>{error}</p>}
    </div>
  );
}
