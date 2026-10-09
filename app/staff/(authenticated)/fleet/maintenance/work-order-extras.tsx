"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { approveWorkOrder, assignWorkOrderRunner, markWorkOrderSettled, sendBackWorkOrder, setApprovalLimit, type WorkOrder } from "./actions";
import { PAYMENT_LABELS, settlementNote, type PaymentArrangement } from "@/lib/maintenance";

// Office controls for jobs a runner started: who/where/how paid, receipts, approve, pay, assign.
export default function WorkOrderExtras({ w, runners }: { w: WorkOrder; runners: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ success: boolean; error?: string }>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.success) setError(res.error ?? "Something went wrong.");
    else router.refresh();
  }

  const owed = settlementNote(w.paymentArrangement, w.cost, Boolean(w.settledAt));
  const done = w.status === "completed" || w.status === "pending_approval";

  return (
    <div style={{ marginTop: 6, fontSize: 13 }}>
      {w.performedBy && (
        <div className="muted-text">
          {w.performedBy === "shop" ? `Shop: ${w.shopName ?? "—"}` : "Done by a runner"}
          {w.paymentArrangement ? ` · ${PAYMENT_LABELS[w.paymentArrangement as PaymentArrangement] ?? w.paymentArrangement}` : ""}
        </div>
      )}
      {w.receiptUrls.length > 0 && (
        <div>
          Receipts:{" "}
          {w.receiptUrls.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noopener noreferrer" style={{ marginRight: 8 }}>#{i + 1}</a>
          ))}
        </div>
      )}
      {w.status === "pending_approval" && (
        <div className="row-actions" style={{ marginTop: 6 }}>
          <strong style={{ color: "#92400e" }}>Over the limit: waiting for you</strong>
          <button type="button" className="button-primary" disabled={busy} onClick={() => run(() => approveWorkOrder(w.id), `Approve this job at $${Number(w.cost ?? 0).toFixed(2)} and put the car back on the lot?`)}>Approve</button>
          <button type="button" className="link-button" disabled={busy} onClick={() => run(() => sendBackWorkOrder(w.id), "Send this back to the runner?")}>Send back</button>
        </div>
      )}
      {owed && done && (
        <div className="row-actions" style={{ marginTop: 6 }}>
          <strong>{owed}</strong>
          <button type="button" className="link-button" disabled={busy} onClick={() => run(() => markWorkOrderSettled(w.id), "Mark this as paid?")}>Mark paid</button>
        </div>
      )}
      {w.status === "open" && runners.length > 0 && (
        <label style={{ display: "block", marginTop: 6 }}>
          Assigned to{" "}
          <select value={w.assignedRunnerId ?? ""} disabled={busy} onChange={(e) => run(() => assignWorkOrderRunner(w.id, e.target.value || null))}>
            <option value="">Nobody</option>
            {runners.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

export function LimitSetting({ limit }: { limit: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(limit));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await setApprovalLimit(value);
    setBusy(false);
    if (res.success) {
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? "Couldn’t save." });
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2 className="card-title card-title--tight">Runner spending limit</h2>
      <p className="muted-text" style={{ fontSize: 13, marginBottom: 8 }}>A runner can finish a job on their own up to this amount. Anything higher waits here for your approval.</p>
      <div className="row-actions">
        <span>$</span>
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" style={{ width: 90 }} aria-label="Spending limit in dollars" />
        <button type="button" className="button-secondary" disabled={busy} onClick={save}>Save</button>
        {msg && <span className={msg.ok ? "muted-text" : "error-text"} style={{ fontSize: 13 }}>{msg.text}</span>}
      </div>
    </div>
  );
}
