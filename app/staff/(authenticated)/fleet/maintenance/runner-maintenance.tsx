"use client";

import { prepareUploadFile } from "@/lib/image-compress";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addMaintenanceReceipt, finishMaintenanceJob, startMaintenanceJob, type RunnerJob } from "./runner-actions";
import { PAYMENT_LABELS, type PaymentArrangement } from "@/lib/maintenance";
import { sentenceCase } from "@/lib/format-label";

type Car = { id: string; label: string };

export default function RunnerMaintenance({ jobs, cars, limit }: { jobs: RunnerJob[]; cars: Car[]; limit: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [performedBy, setPerformedBy] = useState("runner");
  const [openJob, setOpenJob] = useState<string | null>(null);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setMsg(null);
    let res: Awaited<ReturnType<typeof startMaintenanceJob>>;
    try {
      res = await startMaintenanceJob({
        vehicleId: String(f.get("vehicleId") ?? ""),
        workType: String(f.get("workType") ?? ""),
        performedBy: String(f.get("performedBy") ?? ""),
        shopName: String(f.get("shopName") ?? ""),
        paymentArrangement: String(f.get("paymentArrangement") ?? ""),
        notes: String(f.get("notes") ?? ""),
      });
    } catch {
      setBusy(false);
      setMsg({ ok: false, text: "That didn’t go through. Check your signal and try again." });
      return;
    }
    setBusy(false);
    if (res.success) {
      form.reset();
      setPerformedBy("runner");
      setMsg({ ok: true, text: res.note ?? "Job started. The car is out of service." });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? "Couldn’t start that job." });
  }

  return (
    <div>
      {msg && <p className={msg.ok ? "" : "error-text"} style={{ fontSize: 14, marginBottom: 12 }}>{msg.text}</p>}

      <form onSubmit={start} className="card" style={{ marginBottom: 20 }}>
        <h2 className="card-title">Start a job</h2>
        <label className="field">
          <span>Car (only cars that are free right now)</span>
          <select name="vehicleId" defaultValue="">
            <option value="">Choose…</option>
            {cars.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="field"><span>What needs doing</span><input name="workType" maxLength={120} placeholder="Oil change, new tires, brakes…" /></label>
        <label className="field">
          <span>Who is doing the work</span>
          <select name="performedBy" value={performedBy} onChange={(e) => setPerformedBy(e.target.value)}>
            <option value="runner">I am</option>
            <option value="shop">A shop</option>
          </select>
        </label>
        {performedBy === "shop" && <label className="field"><span>Shop name</span><input name="shopName" maxLength={120} /></label>}
        <label className="field">
          <span>How it will be paid</span>
          <select name="paymentArrangement" defaultValue={performedBy === "shop" ? "company_pays_shop" : "runner_reimburse"} key={performedBy}>
            {performedBy === "shop" && <option value="company_pays_shop">{PAYMENT_LABELS.company_pays_shop}</option>}
            <option value="runner_reimburse">{PAYMENT_LABELS.runner_reimburse}</option>
            <option value="company_card">{PAYMENT_LABELS.company_card}</option>
          </select>
        </label>
        <label className="field"><span>Notes (optional)</span><input name="notes" maxLength={500} /></label>
        <button type="submit" className="button-primary" disabled={busy}>{busy ? "Starting…" : "Start job"}</button>
        <p className="muted-text" style={{ fontSize: 12, marginTop: 8 }}>The car comes off the rental list until the job is finished.</p>
      </form>

      <h2 className="card-title">Your jobs</h2>
      {jobs.length === 0 && <p className="muted-text" style={{ fontSize: 14 }}>No jobs yet.</p>}
      {jobs.map((j) => (
        <JobCard key={j.id} job={j} limit={limit} expanded={openJob === j.id} onToggle={() => setOpenJob(openJob === j.id ? null : j.id)} onChanged={(m) => { setMsg(m); router.refresh(); }} />
      ))}
    </div>
  );
}

function JobCard({ job, limit, expanded, onToggle, onChanged }: { job: RunnerJob; limit: number; expanded: boolean; onToggle: () => void; onChanged: (m: { ok: boolean; text: string }) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOpen = job.status === "open";

  async function receipt(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const input = e.target;
    setBusy(true);
    setError(null);
    try {
      const small = await prepareUploadFile(file);
      const fd = new FormData();
      fd.append("file", small);
      const res = await addMaintenanceReceipt(job.id, fd);
      if (res.success) onChanged({ ok: true, text: "Receipt added." });
      else setError(res.error ?? "Couldn’t add that.");
    } catch {
      setError("The receipt didn’t upload. Check your signal and try again.");
    } finally {
      setBusy(false);
      input.value = "";
    }
  }

  async function finish(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!window.confirm("Finish this job? You can’t change it afterward.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await finishMaintenanceJob(job.id, String(f.get("cost") ?? ""), String(f.get("closing") ?? ""));
      if (res.success) onChanged({ ok: true, text: res.note ?? "Done." });
      else setError(res.error ?? "Couldn’t finish that.");
    } catch {
      setError("That didn’t go through. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", cursor: isOpen ? "pointer" : "default" }} onClick={isOpen ? onToggle : undefined}>
        <div>
          <div style={{ fontWeight: 700 }}>{job.vehicle}</div>
          <div className="muted-text" style={{ fontSize: 13 }}>
            {job.workType ?? "Maintenance"} · {job.status === "pending_approval" ? "Waiting for office approval" : sentenceCase(job.status)}
          </div>
          <div className="muted-text" style={{ fontSize: 13 }}>
            {job.performedBy === "shop" ? `Shop: ${job.shopName ?? "—"}` : "Done by you"}
            {job.paymentArrangement ? ` · ${PAYMENT_LABELS[job.paymentArrangement as PaymentArrangement] ?? job.paymentArrangement}` : ""}
            {job.cost !== null ? ` · $${job.cost.toFixed(2)}` : ""}
          </div>
        </div>
        {isOpen && <span className="muted-text" style={{ fontSize: 13 }}>{expanded ? "Close" : "Open"}</span>}
      </div>

      {isOpen && expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Receipts ({job.receiptCount})</p>
          <input type="file" accept="image/*,application/pdf" capture="environment" disabled={busy} onChange={receipt} />
          <form onSubmit={finish} style={{ marginTop: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Finish the job</p>
            <label className="field"><span>Total cost ($, use 0 if free)</span><input name="cost" inputMode="decimal" /></label>
            <label className="field"><span>What was done (optional)</span><input name="closing" maxLength={500} /></label>
            <p className="muted-text" style={{ fontSize: 12, marginBottom: 8 }}>
              Up to ${limit.toFixed(2)} the car goes back on the lot right away. Above that the office approves it first.
              {job.paymentArrangement === "runner_reimburse" ? " A receipt photo is required because you’re being reimbursed." : ""}
            </p>
            {error && <p className="error-text" style={{ fontSize: 13, marginBottom: 8 }}>{error}</p>}
            <button type="submit" className="button-primary" disabled={busy}>{busy ? "Saving…" : "Finish job"}</button>
          </form>
        </div>
      )}
      {!expanded && error && <p className="error-text" style={{ fontSize: 13 }}>{error}</p>}
    </div>
  );
}
