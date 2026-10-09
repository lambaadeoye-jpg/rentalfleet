"use client";

import { useState } from "react";
import { logIncident } from "../fleet/incidents/actions";
import { addToll } from "../tolls/actions";

type Vehicle = { id: string; label: string };

const PROBLEMS = ["Damage", "Accident", "Mechanical problem", "Warning light", "Interior or cleanliness", "Other"];

export default function ReportForms({ vehicles }: { vehicles: Vehicle[] }) {
  const [tab, setTab] = useState<"problem" | "toll">("problem");
  return (
    <div>
      <div className="row-actions" style={{ marginBottom: 16 }}>
        <button type="button" className={tab === "problem" ? "button-primary" : "button-secondary"} onClick={() => setTab("problem")}>Car problem</button>
        <button type="button" className={tab === "toll" ? "button-primary" : "button-secondary"} onClick={() => setTab("toll")}>Toll or ticket</button>
      </div>
      {tab === "problem" ? <ProblemForm vehicles={vehicles} /> : <TollForm vehicles={vehicles} />}
    </div>
  );
}

function ProblemForm({ vehicles }: { vehicles: Vehicle[] }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (!f.get("vehicleId")) return setMsg({ ok: false, text: "Pick the car." });
    setBusy(true);
    setMsg(null);
    const res = await logIncident(String(f.get("type")), String(f.get("vehicleId")), "", String(f.get("description") ?? ""));
    setBusy(false);
    if (res.success) {
      form.reset();
      setMsg({ ok: true, text: "Sent to the office." });
    } else setMsg({ ok: false, text: res.error ?? "Couldn’t send that." });
  }

  return (
    <form onSubmit={submit} className="card">
      <label className="field">
        <span>Car</span>
        <select name="vehicleId" defaultValue="">
          <option value="">Choose…</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>What kind of problem</span>
        <select name="type" defaultValue={PROBLEMS[0]}>
          {PROBLEMS.map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      <label className="field">
        <span>What happened</span>
        <textarea name="description" rows={4} maxLength={1000} placeholder="Where on the car, how bad, anything the office should know" />
      </label>
      {msg && <p className={msg.ok ? "" : "error-text"} style={{ fontSize: 13, marginBottom: 8 }}>{msg.text}</p>}
      <button type="submit" className="button-primary" disabled={busy}>{busy ? "Sending…" : "Send to office"}</button>
    </form>
  );
}

function TollForm({ vehicles }: { vehicles: Vehicle[] }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setMsg(null);
    const res = await addToll({
      vehicleId: String(f.get("vehicleId") ?? ""),
      kind: String(f.get("kind") ?? ""),
      amount: String(f.get("amount") ?? ""),
      occurredAt: String(f.get("occurredAt") ?? ""),
      reference: String(f.get("reference") ?? ""),
      description: String(f.get("description") ?? ""),
    });
    setBusy(false);
    if (res.success) {
      form.reset();
      setMsg({ ok: true, text: "Logged. The office will handle charging the renter." });
    } else setMsg({ ok: false, text: res.error ?? "Couldn’t save that." });
  }

  return (
    <form onSubmit={submit} className="card">
      <label className="field">
        <span>Car</span>
        <select name="vehicleId" defaultValue="">
          <option value="">Choose…</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Type</span>
        <select name="kind" defaultValue="toll">
          <option value="toll">Toll</option>
          <option value="citation">Ticket or citation</option>
        </select>
      </label>
      <label className="field"><span>Amount ($)</span><input name="amount" inputMode="decimal" placeholder="4.50" /></label>
      <label className="field"><span>When it happened</span><input name="occurredAt" type="datetime-local" /></label>
      <label className="field"><span>Ticket or invoice number (optional)</span><input name="reference" maxLength={80} /></label>
      <label className="field"><span>Notes (optional)</span><input name="description" maxLength={200} /></label>
      {msg && <p className={msg.ok ? "" : "error-text"} style={{ fontSize: 13, marginBottom: 8 }}>{msg.text}</p>}
      <button type="submit" className="button-primary" disabled={busy}>{busy ? "Saving…" : "Log it"}</button>
    </form>
  );
}
