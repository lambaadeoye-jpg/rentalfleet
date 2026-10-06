"use client";

import { useState } from "react";
import { createPaymentLink, type PaymentStatus } from "../payment-actions";

const usd = (n: number) => `$${n.toFixed(2)}`;

export default function PaymentCard({ rentalId, status }: { rentalId: string; status: PaymentStatus }) {
  const [url, setUrl] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true); setError(null); setCopied(false);
    const res = await createPaymentLink(rentalId);
    setBusy(false);
    if (!res.success || !res.url) setError(res.error ?? "Couldn't create the link.");
    else { setUrl(res.url); setTotal(res.totalUsd ?? null); }
  }
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Card payment</h2>
      {status.paid ? (
        <>
          <p style={{ fontWeight: 600, color: "var(--signal-green, #16a34a)" }}>
            Paid {usd(status.paid.rentUsd + status.paid.depositUsd)} ({usd(status.paid.rentUsd)} rent + {usd(status.paid.depositUsd)} deposit)
            {status.paid.paidAt ? ` on ${new Date(status.paid.paidAt).toLocaleString()}` : ""}
          </p>
          {status.paid.nameMatches === false && (
            <p style={{ fontSize: 13, marginTop: 6 }}>Name on the card doesn&apos;t match the renter. Check ID and card at pickup.</p>
          )}
        </>
      ) : (
        <>
          {status.review && <p className="error-text" style={{ fontSize: 13, marginBottom: 10 }}>Needs review: {status.review}. Check Stripe before releasing the car.</p>}
          {!status.enabled && <p className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>Card payments are switched off. Turn them on under Settings once Stripe is connected.</p>}
          {status.link && <p className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>A payment link for {usd(status.link.totalUsd)} is active until {new Date(status.link.expiresAt).toLocaleString()}. Creating a new one replaces it.</p>}
          <button className="button-primary" disabled={busy || !status.enabled} onClick={create}>{busy ? "Creating..." : "Create payment link"}</button>
          {url && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 260 }} />
              <button className="button-secondary" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
            </div>
          )}
          {url && <p className="muted-text" style={{ fontSize: 12, marginTop: 6 }}>Total {total != null ? usd(total) : ""}. Send it to the renter only. It expires in 72 hours. The renter must sign the agreement first.</p>}
          {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
        </>
      )}
    </div>
  );
}
