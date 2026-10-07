"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setPaused, createCardLink, type BillingRow } from "./actions";

function money(n: number) { return `$${n.toFixed(2)}`; }
function when(iso: string | null) { return iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"; }

export default function BillingList({ rows }: { rows: BillingRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function cardLink(r: BillingRow) {
    if (!r.customerId) return;
    setBusy(`card:${r.rentalId}`); setErr(null); setCopied(false);
    const res = await createCardLink(r.customerId);
    setBusy(null);
    if (!res.success) { setErr(res.error); return; }
    setLink({ name: r.customerName, url: res.url });
  }

  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setCopied(true); } catch { setErr("Couldn’t copy. Select the link and copy it by hand."); }
  }

  async function toggle(r: BillingRow) {
    setBusy(r.rentalId); setErr(null);
    const res = await setPaused(r.rentalId, !r.paused);
    setBusy(null);
    if (!res.success) setErr(res.error ?? "Couldn’t update."); else router.refresh();
  }

  if (rows.length === 0) return <p className="muted-text">No active weekly rentals yet.</p>;

  const attention = rows.filter((r) => r.lastStatus === "failed" || !r.hasCard);
  return (
    <div>
      {err && <p className="error-text">{err}</p>}
      {link && (
        <div className="card" style={{ marginBottom: 12 }}>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>Update-card link for {link.name} (works for 72 hours, replaces any earlier link)</p>
          <p style={{ fontSize: 13, wordBreak: "break-all", marginBottom: 8 }}>{link.url}</p>
          <button className="button-secondary" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
          <button className="button-secondary" style={{ marginLeft: 8 }} onClick={() => setLink(null)}>Close</button>
          <p className="muted-text" style={{ fontSize: 12, marginTop: 6 }}>Send it by text or email. Their next weekly charge uses the card they save.</p>
        </div>
      )}
      {attention.length > 0 && (
        <p style={{ marginBottom: 12 }}><strong>{attention.length}</strong> need attention (failed charge or no saved card).</p>
      )}
      <table className="data-table">
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
                {r.lastStatus === "failed" && <span className="error-text">Failed (try {r.lastAttemptNo}{(r.lastAttemptNo ?? 0) > 4 ? ", new card" : ""}): {r.lastError}</span>}
                {r.lastStatus === "processing" && <span className="muted-text">Charging…</span>}
                {r.cardUpdatedAt && <div className="muted-text" style={{ fontSize: 12 }}>New card saved {when(r.cardUpdatedAt)}</div>}
                {!r.lastStatus && <span className="muted-text">—</span>}
              </td>
              <td>
                <button className="button-secondary" disabled={busy === r.rentalId} onClick={() => toggle(r)}>
                  {busy === r.rentalId ? "…" : r.paused ? "Resume" : "Pause"}
                </button>
                {r.customerId && (r.lastStatus === "failed" || !r.hasCard) && (
                  <button className="button-secondary" style={{ marginLeft: 6 }} disabled={busy === `card:${r.rentalId}`} onClick={() => cardLink(r)}>
                    {busy === `card:${r.rentalId}` ? "…" : "Card link"}
                  </button>
                )}
                {r.paused && <div className="muted-text" style={{ fontSize: 12 }}>Paused</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
