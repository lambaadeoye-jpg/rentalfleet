"use client";

import { useState } from "react";
import { createSigningLink } from "../applications/agreement-actions";
import { textSigningLink } from "./actions";

// Same link the rental page makes: valid 72 hours, replaces any earlier unsigned link.
export default function SendAgreement({ rentalId, hasLink, phoneLast4 }: { rentalId: string; hasLink: boolean; phoneLast4: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function text() {
    const warn = hasLink ? " This cancels the link already sent." : "";
    if (!window.confirm(`Text the signing link to the number ending ${phoneLast4}?${warn}`)) return;
    setBusy(true);
    setError(null);
    setSentTo(null);
    setUrl(null);
    const res = await textSigningLink(rentalId);
    setBusy(false);
    if (res.success) setSentTo(res.sentTo ?? "the renter");
    else {
      setError(res.error ?? "Couldn’t send the text.");
      if (res.url) setUrl(res.url);
    }
  }

  async function create() {
    if (hasLink && !url && !window.confirm("A signing link is already out. Creating a new one cancels it. Continue?")) return;
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
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ minWidth: 190 }}>
      {phoneLast4 && (
        <div style={{ marginBottom: 4 }}>
          <button type="button" className="link-button" disabled={busy} onClick={text}>
            {busy ? "Working…" : `Text link to renter (•••• ${phoneLast4})`}
          </button>
        </div>
      )}
      {sentTo && <p className="muted-text" style={{ fontSize: 12, marginBottom: 4 }}>Texted to {sentTo}. Good for 72 hours.</p>}
      <button type="button" className="link-button" disabled={busy} onClick={create}>
        {busy ? "Creating…" : url ? "Create another link" : hasLink ? "Replace link" : "Create signing link"}
      </button>
      {url && (
        <div style={{ marginTop: 6 }}>
          <div className="row-actions">
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Signing link" style={{ width: 150, fontSize: 12, padding: "4px 6px" }} />
            <button type="button" className="link-button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <p className="muted-text" style={{ fontSize: 12, marginTop: 4 }}>Send it to the renter only. Good for 72 hours.</p>
        </div>
      )}
      {error && <p className="error-text" style={{ fontSize: 12, marginTop: 4 }}>{error}</p>}
    </div>
  );
}
