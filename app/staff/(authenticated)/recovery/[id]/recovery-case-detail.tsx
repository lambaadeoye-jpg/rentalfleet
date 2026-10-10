"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  authorizeRecoveryCase,
  closeRecoveryCase,
  addRecoveryExpense,
  approveRecoveryExpense,
  type RecoveryCaseDetail,
} from "../actions";
import { EXPENSE_TYPES, type ExpenseType } from "../expense-types";
import { sentenceCase } from "@/lib/format-label";

export default function RecoveryCaseDetailClient({ recoveryCase }: { recoveryCase: RecoveryCaseDetail }) {
  const router = useRouter();
  const [expenseType, setExpenseType] = useState<ExpenseType>("toll");
  const [amount, setAmount] = useState("");
  const [responsibility, setResponsibility] = useState<"renter" | "company">("renter");
  const [loading, setLoading] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAuthorize() {
    if (!window.confirm("Authorize recovery action on this rental? This is a formal step and is recorded under your name.")) return;
    setError(null);
    setLoading(true);
    let result: { success: boolean; error?: string };
    try { result = await authorizeRecoveryCase(recoveryCase.id); } catch { setLoading(false); setError("Couldn’t authorize. Please try again."); return; }
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? "Couldn’t authorize.");
      return;
    }
    router.refresh();
  }

  async function handleClose() {
    if (!window.confirm("Close this recovery case?")) return;
    setError(null);
    setLoading(true);
    let result: { success: boolean; error?: string };
    try { result = await closeRecoveryCase(recoveryCase.id); } catch { setLoading(false); setError("Couldn’t close. Please try again."); return; }
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? "Couldn’t close.");
      return;
    }
    router.refresh();
  }

  async function handleAddExpense() {
    setError(null);
    setLoading(true);
    const result = await addRecoveryExpense(recoveryCase.id, expenseType, Number(amount) || 0, responsibility);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? "Couldn’t add that expense.");
      return;
    }
    setAmount("");
    router.refresh();
  }

  async function handleApprove(expenseId: string) {
    if (!window.confirm("Approve this cost? If the renter is responsible it becomes a charge, taken from their deposit when one is held.")) return;
    setError(null);
    setApprovingId(expenseId);
    let result: { success: boolean; error?: string };
    try { result = await approveRecoveryExpense(expenseId); } catch { setApprovingId(null); setError("Couldn’t approve that expense. Check the case before trying again."); return; }
    setApprovingId(null);
    if (!result.success) {
      setError(result.error ?? "Couldn’t approve that expense.");
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", marginBottom: 8 }}>
          <strong>{sentenceCase(recoveryCase.status.replace(/_/g, " "))}</strong>
          <span>Balance due: ${recoveryCase.balanceDue.toFixed(2)}</span>
        </div>
        <p className="muted-text" style={{ fontSize: 13, marginBottom: 12 }}>{recoveryCase.authorizationReason}</p>
        {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
        <div style={{ display: "flex", gap: 10 }}>
          {!recoveryCase.authorizedAt && (
            <button onClick={handleAuthorize} disabled={loading} className="button-primary">
              Authorize recovery
            </button>
          )}
          {recoveryCase.status !== "closed" && (
            <button onClick={handleClose} disabled={loading} className="button-secondary" style={{ color: "var(--text)", borderColor: "var(--border)" }}>
              Close case
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 className="card-title">Log an expense</h2>
        <div className="form-row">
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Type</span>
            <select value={expenseType} onChange={(e) => setExpenseType(e.target.value as ExpenseType)}>
              {EXPENSE_TYPES.map((t) => (
                <option key={t} value={t}>
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
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Responsibility</span>
          <select value={responsibility} onChange={(e) => setResponsibility(e.target.value as "renter" | "company")}>
            <option value="renter">Renter</option>
            <option value="company">Company</option>
          </select>
        </label>
        <button onClick={handleAddExpense} disabled={loading || !amount} className="button-primary">
          Add expense
        </button>
      </div>

      <h2 className="card-title">Expenses</h2>
      {!recoveryCase.expenses.length && <p className="muted-text" style={{ fontSize: 14 }}>No expenses logged yet.</p>}
      {recoveryCase.expenses.map((e) => (
        <div key={e.id} className="card" style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <span style={{ fontWeight: 700 }}>{sentenceCase(e.expenseType)}</span> — ${e.amount.toFixed(2)} —{" "}
            <span>{sentenceCase(e.responsibility)}</span> —{" "}
            <span>{sentenceCase(e.approvalStatus)}</span>
          </div>
          {e.approvalStatus === "pending" && (
            <button
              onClick={() => handleApprove(e.id)}
              disabled={approvingId === e.id}
              className="button-primary"
            >
              {approvingId === e.id ? "Approving..." : "Approve (charge deposit)"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
