"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { decideRefund, retryRefund, markManualRefundDone, type RefundRow } from "./actions";
import { REASON_LABELS } from "@/lib/refunds";

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const STATUS_LABEL: Record<string, string> = {
  pending_approval: "Needs approval", approved: "Approved, sending", processing: "Sending to card", succeeded: "Refunded",
  failed: "Failed", rejected: "Rejected", no_refund_due: "Nothing to refund", manual_pending: "Refund by hand",
};

function Row({ r }: { r: RefundRow }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ success: boolean; error?: string; note?: string }>) {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false);
    if (!res.success) { setMsg(res.error ?? "Something went wrong."); return; }
    if (res.note) setMsg(res.note);
    router.refresh();
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <p style={{ fontWeight: 700 }}>{r.customerName}</p>
          <p className="muted-text" style={{ fontSize: 13 }}>{REASON_LABELS[r.reason] ?? r.reason} · {r.initiatedBy === "renter" ? "by the renter" : "by staff"} · {new Date(r.createdAt).toLocaleString()}</p>
        </div>
        <p style={{ fontWeight: 700 }}>{STATUS_LABEL[r.status] ?? r.status}</p>
      </div>
      <p style={{ fontSize: 14, marginTop: 8 }}>
        Paid {usd(r.rentPaidCents)} rent + {usd(r.depositPaidCents)} deposit. Fee kept: {usd(r.feeCents)}{r.feeKind !== "none" ? ` (${r.feeKind})` : ""}.
        {" "}<strong>Refund {usd(r.totalRefundCents)}</strong> ({usd(r.rentRefundCents)} rent + {usd(r.depositRefundCents)} deposit).
      </p>
      {r.needsAdmin && r.status === "pending_approval" && <p className="muted-text" style={{ fontSize: 13 }}>Over the approval limit: an admin must approve.</p>}
      {r.manualCents > 0 && (
        <p style={{ fontSize: 13, marginTop: 6 }}>
          {usd(r.manualCents)} was not paid by card. Refund that part by hand (cash, Zelle, etc.){r.status === "manual_pending" ? ", then tap Mark done." : " after the card refund."}
        </p>
      )}
      {r.staffNote && <p className="muted-text" style={{ fontSize: 13, marginTop: 6 }}>Note: {r.staffNote}</p>}
      {r.reviewNote && <p className="muted-text" style={{ fontSize: 13 }}>Decision note: {r.reviewNote}</p>}
      {r.error && <p className="error-text" style={{ fontSize: 13, marginTop: 6 }}>Error: {r.error}</p>}

      {r.status === "pending_approval" && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="button-primary" disabled={busy} onClick={() => run(() => decideRefund(r.id, true, note))}>Approve refund</button>
          <button className="button-secondary" disabled={busy} onClick={() => run(() => decideRefund(r.id, false, note))}>Reject</button>
        </div>
      )}
      {r.status === "failed" && (
        <div style={{ marginTop: 10 }}><button className="button-primary" disabled={busy} onClick={() => run(() => retryRefund(r.id))}>Retry</button></div>
      )}
      {r.status === "manual_pending" && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="How was it refunded?" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="button-primary" disabled={busy} onClick={() => run(() => markManualRefundDone(r.id, note))}>Mark done</button>
        </div>
      )}
      {msg && <p className="muted-text" style={{ fontSize: 13, marginTop: 8 }}>{msg}</p>}
    </div>
  );
}

export default function RefundsList({ refunds }: { refunds: RefundRow[] }) {
  if (refunds.length === 0) return <p className="muted-text">No refunds yet.</p>;
  const open = ["pending_approval", "failed", "manual_pending", "approved", "processing"];
  const sorted = [...refunds].sort((a, b) => Number(open.includes(b.status)) - Number(open.includes(a.status)));
  return <>{sorted.map((r) => <Row key={r.id} r={r} />)}</>;
}
