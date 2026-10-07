"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { openRecoveryCase, type RecoveryCaseSummary, type DelinquentRentalOption } from "./actions";
import { sentenceCase } from "@/lib/format-label";

export default function RecoveryList({
  initialCases,
  rentalOptions,
}: {
  initialCases: RecoveryCaseSummary[];
  rentalOptions: DelinquentRentalOption[];
}) {
  const router = useRouter();
  const [rentalId, setRentalId] = useState("");
  const [balanceDue, setBalanceDue] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen() {
    const option = rentalOptions.find((r) => r.id === rentalId);
    if (!option) {
      setError("Select a rental.");
      return;
    }
    setError(null);
    setLoading(true);
    const result = await openRecoveryCase(rentalId, option.customerId, Number(balanceDue) || 0, reason);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn’t open that case.");
      return;
    }
    setRentalId("");
    setBalanceDue("");
    setReason("");
    router.refresh();
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 className="card-title">Open a recovery case</h2>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Rental</span>
          <select value={rentalId} onChange={(e) => setRentalId(e.target.value)}>
            <option value="">Select an overdue rental</option>
            {rentalOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Balance due ($)</span>
          <input type="number" value={balanceDue} onChange={(e) => setBalanceDue(e.target.value)} />
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Reason *</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="What happened" />
        </label>
        {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
        <button onClick={handleOpen} disabled={loading || !rentalId || !reason.trim()} className="button-primary">
          {loading ? "Opening..." : "Open case"}
        </button>
      </div>

      <h2 className="card-title">Cases</h2>
      {!initialCases.length && <p className="muted-text" style={{ fontSize: 14 }}>No recovery cases yet.</p>}
      {initialCases.map((c) => (
        <Link key={c.id} href={`/staff/recovery/${c.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="card" style={{ marginBottom: 10, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{c.customerName}</strong>
              <span>{sentenceCase(c.status.replace(/_/g, " "))}</span>
            </div>
            <div className="muted-text" style={{ fontSize: 13, marginTop: 4 }}>
              Balance due: ${c.balanceDue.toFixed(2)} · {c.authorizedAt ? "Authorized" : "Not yet authorized"} ·{" "}
              {new Date(c.createdAt).toLocaleDateString()}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
