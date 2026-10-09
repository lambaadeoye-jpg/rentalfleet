"use client";

import { useState, type FormEvent } from "react";
import { addToll, chargeRenter, deleteToll, waiveToll, type TollRow } from "./actions";
import { KIND_LABELS, TOLL_KINDS } from "@/lib/tolls";

type VehicleOption = { id: string; label: string };

const STATUS_TAG: Record<string, string> = { open: "tag tag--warn", charged: "tag tag--good", waived: "tag" };
const STATUS_LABEL: Record<string, string> = { open: "To handle", charged: "Charged", waived: "Waived" };

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function AddForm({ vehicles }: { vehicles: VehicleOption[] }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    setNote(null);
    setLoading(true);
    const d = new FormData(form);
    const result = await addToll({
      vehicleId: String(d.get("vehicleId") || ""),
      kind: String(d.get("kind") || ""),
      amount: String(d.get("amount") || ""),
      occurredAt: String(d.get("occurredAt") || ""),
      reference: String(d.get("reference") || ""),
      description: String(d.get("description") || ""),
    });
    setLoading(false);
    if (!result.success) return setError(result.error ?? "Couldn’t save that.");
    form.reset();
    setNote(result.note ?? "Saved.");
  }

  return (
    <form onSubmit={onSubmit} className="card" style={{ maxWidth: 640, marginBottom: 24 }}>
      <h2 className="card-title card-title--tight">Log a toll or ticket</h2>
      <p className="muted-text" style={{ marginBottom: 16 }}>
        We find the renter who had the car at that moment. Times are Central.
      </p>
      <div className="form-row">
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Vehicle</span>
          <select name="vehicleId" required defaultValue="">
            <option value="" disabled>Select a vehicle</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Type</span>
          <select name="kind" defaultValue="toll">
            {TOLL_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Amount ($)</span>
          <input name="amount" required inputMode="decimal" placeholder="4.50" />
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>When it happened</span>
          <input name="occurredAt" type="datetime-local" required />
        </label>
      </div>
      <div className="form-row">
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Invoice or ticket number (optional)</span>
          <input name="reference" maxLength={80} />
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Note (optional)</span>
          <input name="description" maxLength={200} placeholder="e.g. Briley Pkwy toll" />
        </label>
      </div>
      {error && <p className="error-text" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      {note && <p className="muted-text" style={{ marginBottom: 12 }}>{note}</p>}
      <button type="submit" className="button-primary" disabled={loading}>{loading ? "Saving…" : "Save"}</button>
    </form>
  );
}

function RowActions({ row }: { row: TollRow }) {
  const [busy, setBusy] = useState(false);
  const [fee, setFee] = useState(String(row.defaultFee));
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ success: boolean; error?: string; note?: string }>) {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.success) setError(r.error ?? "Something went wrong.");
    else if (r.note) setMsg(r.note);
  }

  if (row.status === "charged") {
    return <span className="muted-text" style={{ fontSize: 13 }}>{row.chargeStatus === "approved" ? "Charge approved" : "Waiting for approval on Charges"}</span>;
  }
  if (row.status === "waived") return null;

  return (
    <div>
      <div className="row-actions">
        {row.rentalId && (
          <>
            <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Fee $
              <input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" aria-label="Administrative fee" style={{ width: 56, marginLeft: 4, padding: "4px 6px", fontSize: 13 }} />
            </label>
            <button type="button" className="link-button" disabled={busy} onClick={() => run(() => chargeRenter(row.id, fee))}>Charge renter</button>
          </>
        )}
        <button type="button" className="link-button" disabled={busy} onClick={() => run(() => waiveToll(row.id))}>Waive</button>
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={() => window.confirm("Delete this entry?") && run(() => deleteToll(row.id))}
        >
          Delete
        </button>
      </div>
      {msg && <p className="muted-text" style={{ fontSize: 12, marginTop: 4 }}>{msg}</p>}
      {error && <p className="error-text" style={{ fontSize: 12, marginTop: 4 }}>{error}</p>}
    </div>
  );
}

export default function TollsView({ rows, vehicles }: { rows: TollRow[]; vehicles: VehicleOption[] }) {
  return (
    <>
      <AddForm vehicles={vehicles} />
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        {rows.length === 0 ? (
          <p className="muted-text" style={{ padding: 24 }}>Nothing logged yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>{["When", "Type", "Vehicle", "Renter", "Amount", "Status", ""].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="cell-muted">{when(r.occurredAt)}</td>
                  <td className="cell-strong">
                    {KIND_LABELS[r.kind]}
                    {(r.reference || r.description) && (
                      <div style={{ fontSize: 12, fontWeight: 400, color: "var(--text-secondary)" }}>{[r.reference, r.description].filter(Boolean).join(" · ")}</div>
                    )}
                  </td>
                  <td className="cell-muted">{r.vehicle}{r.plate ? <div style={{ fontSize: 12 }}>{r.plate}</div> : null}</td>
                  <td className="cell-muted">{r.renter ?? <span className="tag tag--bad">No renter found</span>}</td>
                  <td className="cell-muted">${r.amount.toFixed(2)}</td>
                  <td><span className={STATUS_TAG[r.status]}>{STATUS_LABEL[r.status]}</span></td>
                  <td><RowActions row={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
