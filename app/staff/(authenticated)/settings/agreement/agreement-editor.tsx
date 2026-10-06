"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RENTAL_PLACEHOLDERS, VARIABLE_KEYS, VARIABLE_LABELS, hasCounselNotes, type AgreementClause, type AgreementTemplate,
} from "@/lib/agreement";
import { createAgreementDraft, saveAgreementDraft, approveAgreementVersion, type TemplateVersion } from "./template-actions";

function VersionEditor({ v }: { v: TemplateVersion }) {
  const router = useRouter();
  const locked = v.status === "approved";
  const [title, setTitle] = useState(v.title);
  const [intro, setIntro] = useState(v.template.intro);
  const [clauses, setClauses] = useState<AgreementClause[]>(v.template.clauses);
  const [vars, setVars] = useState<Record<string, string>>(v.variables);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmNotes, setConfirmNotes] = useState(false);

  const current: AgreementTemplate = { intro, clauses };
  const notesOpen = hasCounselNotes(current);

  function patch(i: number, p: Partial<AgreementClause>) {
    setClauses((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...p } : c)));
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    const res = await saveAgreementDraft(v.id, title, current, vars);
    setBusy(false);
    setMsg(res.success ? { ok: true, text: "Draft saved." } : { ok: false, text: res.error ?? "Couldn't save." });
  }

  async function approve(ack: boolean) {
    setBusy(true);
    // Save first so what is approved is exactly what is on screen.
    const saved = await saveAgreementDraft(v.id, title, current, vars);
    if (!saved.success) { setBusy(false); setMsg({ ok: false, text: saved.error ?? "Couldn't save." }); return; }
    const res = await approveAgreementVersion(v.id, ack);
    setBusy(false);
    if (res.needsAck) { setConfirmNotes(true); return; }
    if (!res.success) { setMsg({ ok: false, text: res.error ?? "Couldn't approve." }); return; }
    setConfirmNotes(false);
    router.refresh();
  }

  async function copy() {
    setBusy(true);
    const res = await createAgreementDraft(v.id);
    setBusy(false);
    if (!res.success) setMsg({ ok: false, text: res.error ?? "Couldn't copy." });
    else router.refresh();
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <h2 style={{ fontSize: 16 }}>
          Version {v.version}{" "}
          <span style={{ fontSize: 12, fontWeight: 700, color: locked ? "var(--signal-green, #16a34a)" : "inherit" }}>
            {locked ? `Approved ${v.approvedAt ? new Date(v.approvedAt).toLocaleDateString() : ""}` : "Draft"}
          </span>
        </h2>
        {locked && <button className="button-secondary" disabled={busy} onClick={copy}>Make a new draft from this</button>}
      </div>

      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Name (for your reference)</span>
        <input value={title} disabled={locked} onChange={(e) => { setTitle(e.target.value); setMsg(null); }} maxLength={120} />
      </label>
      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Opening paragraph</span>
        <textarea rows={3} value={intro} disabled={locked} onChange={(e) => { setIntro(e.target.value); setMsg(null); }} />
      </label>

      {clauses.map((c, i) => (
        <div key={i} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <strong style={{ width: 28 }}>{c.number}.</strong>
            <input value={c.title} disabled={locked} onChange={(e) => patch(i, { title: e.target.value })} style={{ flex: 1, minWidth: 180 }} maxLength={120} />
            <label className="checkbox-item">
              <input type="checkbox" checked={c.initial} disabled={locked} onChange={(e) => patch(i, { initial: e.target.checked })} />
              Renter initials
            </label>
            {!locked && (
              <button className="button-secondary" onClick={() => setClauses((cs) => cs.filter((_, idx) => idx !== i).map((x, n) => ({ ...x, number: n + 1 })))}>Remove</button>
            )}
          </div>
          <textarea rows={Math.min(12, Math.max(3, Math.ceil(c.body.length / 90)))} value={c.body} disabled={locked} onChange={(e) => patch(i, { body: e.target.value })} style={{ width: "100%" }} />
        </div>
      ))}
      {!locked && (
        <button className="button-secondary" style={{ marginTop: 10 }}
          onClick={() => setClauses((cs) => [...cs, { number: cs.length + 1, title: "New clause", body: "", initial: false }])}>
          Add a clause
        </button>
      )}

      <h3 style={{ fontSize: 14, margin: "20px 0 6px" }}>Fixed values used in the text</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
        {VARIABLE_KEYS.map((k) => (
          <label className="field" key={k}>
            <span style={{ fontSize: 12 }}>{VARIABLE_LABELS[k]}</span>
            <input value={vars[k] ?? ""} disabled={locked} onChange={(e) => { setVars((x) => ({ ...x, [k]: e.target.value })); setMsg(null); }} maxLength={120} />
          </label>
        ))}
      </div>
      <p className="muted-text" style={{ fontSize: 12, marginTop: 10 }}>
        Filled in automatically for each renter: {RENTAL_PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}. Use them exactly as written. Fixed values use {VARIABLE_KEYS.map((p) => `{{${p}}}`).join(", ")}.
      </p>

      {!locked && notesOpen && (
        <p style={{ fontSize: 13, marginTop: 12, color: "var(--danger, #b91c1c)" }}>
          This text still has [Counsel: ...] notes. Renters would see them. Resolve them with your lawyer before approving, or approve only for testing.
        </p>
      )}
      {msg && <p className={msg.ok ? undefined : "error-text"} style={msg.ok ? { color: "var(--signal-green, #16a34a)", marginTop: 10 } : { marginTop: 10 }}>{msg.text}</p>}
      {!locked && (
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button className="button-secondary" disabled={busy} onClick={save}>Save draft</button>
          <button className="button-primary" disabled={busy} onClick={() => approve(false)}>Approve and lock</button>
        </div>
      )}
      {confirmNotes && (
        <div className="card" style={{ marginTop: 12, borderColor: "var(--danger, #b91c1c)" }}>
          <p style={{ fontSize: 14, marginBottom: 10 }}>
            This version still contains [Counsel: ...] notes and will be locked as is. Renters will see that text when they sign. Approve anyway?
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="button-primary" disabled={busy} onClick={() => approve(true)}>Yes, approve and lock</button>
            <button className="button-secondary" onClick={() => setConfirmNotes(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AgreementEditor({ versions }: { versions: TemplateVersion[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    const res = await createAgreementDraft();
    setBusy(false);
    if (!res.success) setError(res.error ?? "Couldn't create the draft.");
    else router.refresh();
  }

  return (
    <>
      {versions.length === 0 && (
        <div className="card">
          <p style={{ marginBottom: 12 }}>No agreement yet. Start from Zivo&apos;s draft (19 clauses, written for counsel to review) and edit it.</p>
          <button className="button-primary" disabled={busy} onClick={start}>Start from Zivo&apos;s draft</button>
          {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
        </div>
      )}
      {versions.map((v) => (
        <VersionEditor key={v.id} v={v} />
      ))}
    </>
  );
}
