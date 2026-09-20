"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import { confirmDropoff, recordPayment } from "../applications/rental-actions";
import type { DropoffItem } from "./list-actions";

export default function DropoffCard({ item }: { item: DropoffItem }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [endMileage, setEndMileage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSaved, setPaymentSaved] = useState(false);

  async function handleConfirmDropoff() {
    if (!endMileage) {
      setError("Enter the ending mileage.");
      return;
    }
    if (item.startMileage !== null && Number(endMileage) < item.startMileage) {
      setError(`Ending mileage can't be less than the starting mileage (${item.startMileage}).`);
      return;
    }

    // Critical action -- confirm before it actually happens.
    const confirmed = window.confirm(
      `Confirm return of the ${item.vehicleLabel} from ${item.customerFirstName} ${item.customerLastName}? This closes the rental and cannot be undone from here.`
    );
    if (!confirmed) return;

    setError(null);
    setLoading(true);
    const result = await confirmDropoff(item.rentalId, Number(endMileage));
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't confirm dropoff. Please try again.");
      return;
    }
    router.refresh();
  }

  async function handleRecordPayment() {
    if (!paymentAmount) {
      setPaymentError("Enter an amount.");
      return;
    }

    // Critical action -- confirm before it actually happens.
    const confirmed = window.confirm(`Record a ${paymentMethod} payment of $${paymentAmount}? This creates a real payment record.`);
    if (!confirmed) return;

    setPaymentError(null);
    setPaymentSaved(false);
    setPaymentLoading(true);
    const result = await recordPayment(item.rentalId, Number(paymentAmount), paymentMethod);
    setPaymentLoading(false);

    if (!result.success) {
      setPaymentError(result.error ?? "Couldn't record that payment. Please try again.");
      return;
    }
    setPaymentAmount("");
    setPaymentSaved(true);
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {item.customerFirstName} {item.customerLastName}
          </div>
          <div className="muted-text" style={{ fontSize: 13 }}>{item.vehicleLabel}</div>
        </div>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </div>

      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          {/* Record a payment */}
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Record a payment</p>
          <div className="form-row" style={{ marginBottom: 8 }}>
            <label className="field">
              <span style={{ fontSize: 13, fontWeight: 600 }}>Amount ($)</span>
              <input type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
            </label>
            <label className="field">
              <span style={{ fontSize: 13, fontWeight: 600 }}>Method</span>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="venmo">Venmo</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          {paymentError && <p className="error-text" style={{ fontSize: 13, marginBottom: 8 }}>{paymentError}</p>}
          {paymentSaved && (
            <p style={{ color: "var(--signal-green, #16a34a)", fontSize: 13, marginBottom: 8 }}>Payment recorded.</p>
          )}
          <button
            onClick={handleRecordPayment}
            disabled={paymentLoading}
            className="button-secondary"
            style={{ color: "var(--text)", borderColor: "var(--border)", marginBottom: 20 }}
          >
            {paymentLoading ? "Recording..." : "Record Payment"}
          </button>

          {/* Confirm dropoff */}
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            Confirm return
          </p>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              Ending mileage {item.startMileage !== null && `(started at ${item.startMileage})`}
            </span>
            <input type="number" value={endMileage} onChange={(e) => setEndMileage(e.target.value)} />
          </label>
          {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
          <button onClick={handleConfirmDropoff} disabled={loading} className="button-primary">
            {loading ? "Confirming..." : "Confirm Dropoff"}
          </button>
        </div>
      )}
    </div>
  );
}
