"use client";

import { useState } from "react";
import { createSigningLink, type AgreementStatus } from "../agreement-actions";

export default function AgreementCard({ rentalId, status }: { rentalId: string; status: AgreementStatus }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    setCopied(false);
    const res = await createSigningLink(rentalId);
    setBusy(false);
    if (!res.success || !res.url) setError(res.error ?? "Couldn’t create the link.");
    else setUrl(res.url);
  }

  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h2 className="card-title">Rental agreement</h2>
      {status.signed ? (
        <>
          <p style={{ fontWeight: 600, color: "var(--signal-green, #16a34a)" }}>
            Signed by {status.signed.signerName} on {new Date(status.signed.signedAt).toLocaleString()}
          </p>
          {status.signed.url && (
            <a href={status.signed.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-dark)", fontSize: 13, fontWeight: 600 }}>
              View signed copy (link expires in 10 min)
            </a>
          )}
        </>
      ) : (
        <>
          {!status.hasApprovedVersion && (
            <p className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>
              No approved agreement text yet. Approve one under Settings → Rental agreement first.
            </p>
          )}
          {status.link && <p className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>A signing link is active until {new Date(status.link.expiresAt).toLocaleString()}. Creating a new one replaces it.</p>}
          <button className="button-primary" disabled={busy || !status.hasApprovedVersion} onClick={create}>{busy ? "Creating..." : "Create signing link"}</button>
          {url && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 260 }} />
              <button className="button-secondary" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
            </div>
          )}
          {url && <p className="muted-text" style={{ fontSize: 12, marginTop: 6 }}>Send it to the renter only. It expires in 72 hours. The text is frozen when you create the link, so create a new one if the rent, vehicle or pickup changes.</p>}
          {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
        </>
      )}
    </div>
  );
}
