"use client";

import { useState } from "react";
import { createUploadLink, reviewDocument } from "../document-actions";
import { UPLOAD_DOCUMENT_TYPES, DOCUMENT_LABELS, reviewBadge } from "@/lib/upload-validation";

export type DocRow = {
  id: string;
  document_type: string;
  review_status: string;
  review_note: string | null;
  created_at: string;
  url: string | null;
  source: string;
};

function Row({ applicationId, doc }: { applicationId: string; doc: DocRow }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const badge = reviewBadge(doc.review_status);

  async function act(status: "accepted" | "rejected") {
    setBusy(true);
    setError(null);
    const res = await reviewDocument(applicationId, doc.id, status, note);
    setBusy(false);
    if (!res.success) setError(res.error ?? "Couldn’t save.");
    else setRejecting(false);
  }

  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{DOCUMENT_LABELS[doc.document_type] ?? doc.document_type}</span>
          <span className="muted-text" style={{ fontSize: 12, marginLeft: 8 }}>
            {new Date(doc.created_at).toLocaleDateString()}{doc.source === "upload_link" ? " · via link" : ""}
          </span>
          <span
            style={{
              marginLeft: 8, fontSize: 12, fontWeight: 700,
              color: badge.tone === "ok" ? "var(--signal-green, #16a34a)" : badge.tone === "warn" ? "var(--danger, #b91c1c)" : "inherit",
            }}
          >
            {badge.tone === "wait" ? "Needs review" : badge.text}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {doc.url ? (
            <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal)", fontSize: 13, fontWeight: 600 }}>View</a>
          ) : (
            <span className="muted-text" style={{ fontSize: 13 }}>Unavailable</span>
          )}
          <button className="button-secondary" disabled={busy || doc.review_status === "accepted"} onClick={() => act("accepted")}>Accept</button>
          <button className="button-secondary" disabled={busy} onClick={() => setRejecting((r) => !r)}>Needs redo</button>
        </div>
      </div>
      {doc.review_status === "rejected" && doc.review_note && !rejecting && (
        <p className="muted-text" style={{ fontSize: 12, marginTop: 4 }}>Note to renter: {doc.review_note}</p>
      )}
      {rejecting && (
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should they fix? e.g. photo is blurry" style={{ flex: 1, minWidth: 220 }} maxLength={500} />
          <button className="button-primary" disabled={busy} onClick={() => act("rejected")}>Send note</button>
        </div>
      )}
      {error && <p className="error-text" style={{ marginTop: 6 }}>{error}</p>}
    </div>
  );
}

function LinkCard({ applicationId, missing }: { applicationId: string; missing: string[] }) {
  const [types, setTypes] = useState<string[]>(missing.length ? missing : [...UPLOAD_DOCUMENT_TYPES]);
  const [url, setUrl] = useState<string | null>(null);
  const [hours, setHours] = useState(72);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    setCopied(false);
    const res = await createUploadLink(applicationId, types);
    setBusy(false);
    if (!res.success || !res.url) { setError(res.error ?? "Couldn’t create the link."); return; }
    setUrl(res.url);
    setHours(res.hours ?? 72);
  }

  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Request documents by link</h3>
      <p className="muted-text" style={{ fontSize: 12, marginBottom: 10 }}>
        Makes a private link the renter opens on their phone, no sign-in. It replaces any earlier link and expires in {hours} hours.
      </p>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 10 }}>
        {UPLOAD_DOCUMENT_TYPES.map((t) => (
          <label key={t} className="checkbox-item">
            <input
              type="checkbox"
              checked={types.includes(t)}
              onChange={(e) => setTypes((cur) => (e.target.checked ? [...cur, t] : cur.filter((x) => x !== t)))}
            />
            {DOCUMENT_LABELS[t]}
          </label>
        ))}
      </div>
      <button className="button-primary" disabled={busy || types.length === 0} onClick={create}>{busy ? "Creating..." : "Create link"}</button>
      {url && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 260 }} />
          <button className="button-secondary" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        </div>
      )}
      {url && <p className="muted-text" style={{ fontSize: 12, marginTop: 6 }}>Send it by text or email. Anyone with the link can upload, so send it only to the renter.</p>}
      {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}

export default function DocumentPanel({ applicationId, docs }: { applicationId: string; docs: DocRow[] }) {
  const have = new Set(docs.map((d) => d.document_type));
  const missing = UPLOAD_DOCUMENT_TYPES.filter((t) => !have.has(t));
  return (
    <>
      {docs.length === 0 ? (
        <p className="muted-text" style={{ fontSize: 14 }}>No documents uploaded yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {docs.map((d) => (
            <Row key={d.id} applicationId={applicationId} doc={d} />
          ))}
        </div>
      )}
      <LinkCard applicationId={applicationId} missing={missing} />
    </>
  );
}
