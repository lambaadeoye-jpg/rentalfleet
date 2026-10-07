"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setPaused, type BillingRow } from "./actions";

function money(n: number) { return `$${n.toFixed(2)}`; }
function when(iso: string | null) { return iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"; }

export default function BillingList({ rows }: { rows: BillingRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(r: BillingRow) {
    setBusy(r.rentalId); setErr(null);
    const res = await setPaused(r.rentalId, !r.paused);
    setBusy(null);
    if (!res.success) setErr(res.error ?? "Couldn't update."); else router.refresh();
  }

  if (rows.length === 0) return <p className="muted-text">No active weekly rentals yet.</p>;

  const attention = rows.filter((r) => r.lastStatus === "failed" || !r.hasCard);
  return (
    <div>
      {err && <p className="error-text">{err}</p>}
      {attention.length > 0 && (
        <p style={{ marginBottom: 12 }}><strong>{attention.length}</strong> need attention (failed charge or no saved card).</p>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th style={{ padding: "6px 8px" }}>Renter</th><th>Weekly</th><th>Next due</th><th>Weeks paid</th><th>Last charge</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.scheduleId} style={{ borderTop: "1px solid rgba(128,128,128,0.25)" }}>
              <td style={{ padding: "8px" }}>{r.customerName}{!r.hasCard && <div className="error-text" style={{ fontSize: 12 }}>No saved card</div>}</td>
              <td>{money(r.weeklyAmount)}</td>
              <td>{when(r.nextDueAt)}{r.overdue && <div className="error-text" style={{ fontSize: 12 }}>Overdue</div>}</td>
              <td>{r.weeksPaid}</td>
              <td>
                {r.lastStatus === "succeeded" && <span>Paid · {when(r.lastAt)}</span>}
                {r.lastStatus === "failed" && <span className="error-text">Failed (try {r.lastAttemptNo} of 4): {r.lastError}</span>}
                {r.lastStatus === "processing" && <span className="muted-text">Charging…</span>}
                {!r.lastStatus && <span className="muted-text">—</span>}
              </td>
              <td>
                <button className="button-secondary" disabled={busy === r.rentalId} onClick={() => toggle(r)}>
                  {busy === r.rentalId ? "…" : r.paused ? "Resume" : "Pause"}
                </button>
                {r.paused && <div className="muted-text" style={{ fontSize: 12 }}>Paused</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
