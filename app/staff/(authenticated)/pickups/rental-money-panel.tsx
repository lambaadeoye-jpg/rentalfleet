"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordPayment, changeRentalInsurance } from "../applications/rental-actions";
import type { RentalMoney } from "./list-actions";

const usd = (n: number | null) => (n === null ? "—" : `$${n.toFixed(2)}`);

// Staff-only: the renter's agreed rate, what's been collected, and how to
// record rent / deposit payments (card only) or change the insurance
// arrangement. Renters never see this panel.
export default function RentalMoneyPanel({ rentalId, money }: { rentalId: string; money: RentalMoney }) {
  const router = useRouter();
  const [kind, setKind] = useState<"rent" | "deposit">("rent");
  const [amount, setAmount] = useState("");
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [paySaved, setPaySaved] = useState(false);

  const [arrangement, setArrangement] = useState(money.arrangement ?? "own");
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateSaved, setRateSaved] = useState<string | null>(null);

  const firstRentDue = money.plan === "weekly" ? money.weeklyRateUsd : money.quotedAmountUsd;
  const arrangementLabel =
    money.arrangement === "own" ? "Own insurance (discount applied)" : money.arrangement === "via_provider" ? "Buying cover via a provider (insurance deducted)" : "Not recorded (older rental)";

  async function handlePay() {
    if (!amount || Number(amount) <= 0) {
      setPayError("Enter an amount.");
      return;
    }
    const label = kind === "deposit" ? "refundable deposit" : "rent";
    if (!window.confirm(`Record a card payment of $${amount} as ${label}? This creates a real payment record.`)) return;
    setPayError(null);
    setPaySaved(false);
    setPayLoading(true);
    const result = await recordPayment(rentalId, Number(amount), "card", kind);
    setPayLoading(false);
    if (!result.success) {
      setPayError(result.error ?? "Couldn't record that payment. Please try again.");
      return;
    }
    setAmount("");
    setPaySaved(true);
    router.refresh();
  }

  async function handleChangeArrangement() {
    if (!window.confirm("Change this renter's insurance arrangement? Their rate is recalculated from the current pricing and applies from the next payment.")) return;
    setRateError(null);
    setRateSaved(null);
    setRateLoading(true);
    const result = await changeRentalInsurance(rentalId, arrangement as "own" | "via_provider");
    setRateLoading(false);
    if (!result.success) {
      setRateError(result.error ?? "Couldn't change the rate.");
      return;
    }
    setRateSaved(result.newWeeklyRate != null ? `Updated. New weekly rate: ${usd(result.newWeeklyRate)}.` : "Updated.");
    router.refresh();
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Rate, rent &amp; deposit (staff only)</p>
      <div className="muted-text" style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.6 }}>
        <div>{arrangementLabel}</div>
        {money.plan === "weekly" && <div>Weekly rent: {usd(money.weeklyRateUsd)}{money.nextDueAt ? ` · next due ${new Date(money.nextDueAt).toLocaleDateString()}` : ""}</div>}
        {money.plan === "daily" && <div>Rental total: {usd(money.quotedAmountUsd)}</div>}
        <div>
          Rent collected: {usd(money.rentPaidUsd)}
          {firstRentDue !== null ? ` (first payment due before pickup: ${usd(firstRentDue)})` : ""}
        </div>
        <div>
          Refundable deposit: {usd(money.depositPaidUsd)} collected of {usd(money.depositRequiredUsd)}
        </div>
      </div>

      <div className="form-row" style={{ marginBottom: 8 }}>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as "rent" | "deposit")}>
            <option value="rent">Rent</option>
            <option value="deposit">Refundable deposit</option>
          </select>
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Amount ($)</span>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      </div>
      <p className="muted-text" style={{ fontSize: 12, marginBottom: 8 }}>Card only, in the renter&apos;s own name. No cash.</p>
      {payError && <p className="error-text" style={{ fontSize: 13, marginBottom: 8 }}>{payError}</p>}
      {paySaved && <p style={{ color: "var(--signal-green, #16a34a)", fontSize: 13, marginBottom: 8 }}>Payment recorded.</p>}
      <button onClick={handlePay} disabled={payLoading} className="button-secondary" style={{ color: "var(--text)", borderColor: "var(--border)", marginBottom: 16 }}>
        {payLoading ? "Recording..." : "Record Payment"}
      </button>

      {money.arrangement && (
        <div>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Change insurance arrangement (admin)</span>
            <select value={arrangement} onChange={(e) => setArrangement(e.target.value as "own" | "via_provider")}>
              <option value="own">Own insurance</option>
              <option value="via_provider">Buying cover via a provider</option>
            </select>
          </label>
          {rateError && <p className="error-text" style={{ fontSize: 13, marginBottom: 8 }}>{rateError}</p>}
          {rateSaved && <p style={{ color: "var(--signal-green, #16a34a)", fontSize: 13, marginBottom: 8 }}>{rateSaved}</p>}
          <button
            onClick={handleChangeArrangement}
            disabled={rateLoading || arrangement === money.arrangement}
            className="button-secondary"
            style={{ color: "var(--text)", borderColor: "var(--border)" }}
          >
            {rateLoading ? "Updating..." : "Update rate"}
          </button>
        </div>
      )}
    </div>
  );
}
