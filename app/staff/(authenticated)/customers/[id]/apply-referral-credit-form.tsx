"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { applyReferralCredit } from "./referral-credit-actions";

export default function ApplyReferralCreditForm({ customerId, maxAmount }: { customerId: string; maxAmount: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState(maxAmount.toFixed(2));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function handleApply() {
    const numAmount = Number(amount);
    const confirmed = window.confirm(`Apply $${numAmount.toFixed(2)} referral credit toward this customer's balance?`);
    if (!confirmed) return;

    setError(null);
    setLoading(true);
    const result = await applyReferralCredit(customerId, numAmount);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't apply that credit.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="button-primary">
        Apply Credit
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          max={maxAmount}
          style={{ width: 100 }}
        />
        <button onClick={handleApply} disabled={loading} className="button-primary">
          {loading ? "Applying..." : "Confirm"}
        </button>
      </div>
      {error && <p className="error-text" style={{ fontSize: 12 }}>{error}</p>}
    </div>
  );
}
