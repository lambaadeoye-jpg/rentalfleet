"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logCharge, approveCharge, type ChargeRecord, type RentalOption } from "./actions";

const CHARGE_TYPES = ["toll", "ticket", "cleaning", "damage", "other"] as const;

export default function ChargesList({ initialCharges, rentals }: { initialCharges: ChargeRecord[]; rentals: RentalOption[] }) {
  const router = useRouter();
  const [rentalId, setRentalId] = useState("");
  const [chargeType, setChargeType] = useState<(typeof CHARGE_TYPES)[number]>("toll");
  const [amount, setAmount] = useState("");
  const [deductFromDeposit, setDeductFromDeposit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const selectedRental = rentals.find((r) => r.id === rentalId);

  async function handleLog() {
    if (!selectedRental) return;
    setError(null);
    setLoading(true);
    const result = await logCharge(rentalId, selectedRental.customerId, chargeType, Number(amount), deductFromDeposit);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't log that charge.");
      return;
    }
    setRentalId("");
    setAmount("");
    setDeductFromDeposit(false);
    router.refresh();
  }

  async function handleApprove(charge: ChargeRecord) {
    const message = charge.isDeductible
      ? `Approve $${charge.amount.toFixed(2)} charge for ${charge.customerName}? This will deduct directly from their held deposit.`
      : `Approve $${charge.amount.toFixed(2)} charge for ${charge.customerName}?`;
    if (!window.confirm(message)) return;

    setApprovingId(charge.id);
    const result = await approveCharge(charge.id);
    setApprovingId(null);

    if (!result.success) {
      setError(result.error ?? "Couldn't approve that charge.");
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Log a charge</h2>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Rental</span>
          <select value={rentalId} onChange={(e) => setRentalId(e.target.value)}>
            <option value="">Select a rental</option>
            {rentals.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Type</span>
            <select value={chargeType} onChange={(e) => setChargeType(e.target.value as (typeof CHARGE_TYPES)[number])}>
              {CHARGE_TYPES.map((t) => (
                <option key={t} value={t} style={{ textTransform: "capitalize" }}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Amount ($)</span>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        </div>
        {selectedRental?.hasOpenDeposit && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 8 }}>
            <input type="checkbox" checked={deductFromDeposit} onChange={(e) => setDeductFromDeposit(e.target.checked)} />
            Deduct from held deposit instead of billing separately
          </label>
        )}
        {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
        <button onClick={handleLog} disabled={loading || !rentalId || !amount} className="button-primary">
          {loading ? "Logging..." : "Log Charge"}
        </button>
      </div>

      {initialCharges.map((c) => (
        <div key={c.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700 }}>
              {c.customerName} — ${c.amount.toFixed(2)}
            </div>
            <div className="muted-text" style={{ fontSize: 13, textTransform: "capitalize" }}>
              {c.chargeType} {c.isDeductible && "— deposit deduction"} — {c.approvalStatus}
            </div>
          </div>
          {c.approvalStatus === "pending" && (
            <button
              onClick={() => handleApprove(c)}
              disabled={approvingId === c.id}
              className="button-primary"
            >
              {approvingId === c.id ? "Approving..." : "Approve"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
