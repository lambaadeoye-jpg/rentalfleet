"use client";

import { useState, type FormEvent } from "react";
import { deleteAdSpend, saveAdSpend } from "./spend-actions";

export type SpendEntry = { id: string; month: string; source: string; amount: number };

export default function SpendEditor({ entries, sources, defaultMonth }: { entries: SpendEntry[]; sources: string[]; defaultMonth: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    const r = await saveAdSpend({ month: String(f.get("month") ?? ""), source: String(f.get("source") ?? ""), amount: String(f.get("amount") ?? "") });
    setBusy(false);
    setMsg({ ok: r.success, text: r.success ? "Saved." : r.error ?? "Couldn’t save." });
    if (r.success) (form.elements.namedItem("amount") as HTMLInputElement).value = "";
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this spend entry?")) return;
    const r = await deleteAdSpend(id);
    setMsg({ ok: r.success, text: r.success ? "Deleted." : r.error ?? "Couldn’t delete." });
  }

  return (
    <div>
      <form onSubmit={submit} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <label style={{ fontSize: 12 }}>Month<input name="month" type="month" defaultValue={defaultMonth} required style={{ display: "block" }} /></label>
        <label style={{ fontSize: 12 }}>Channel
          <input name="source" list="spend-sources" placeholder="meta_ads" required style={{ display: "block" }} />
          <datalist id="spend-sources">{sources.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label style={{ fontSize: 12 }}>Spent ($)<input name="amount" inputMode="decimal" placeholder="250" required style={{ display: "block" }} /></label>
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        {msg ? <span className={msg.ok ? "muted-text" : "error-text"}>{msg.text}</span> : null}
      </form>
      <p className="muted-text" style={{ fontSize: 12, marginTop: 6 }}>Use the channel names shown in the lead sources table so spend lines up with leads. Saving the same channel and month again replaces it.</p>
      {entries.length > 0 && (
        <table className="viz-table" aria-label="Ad spend entered" style={{ marginTop: 8 }}>
          <thead><tr><th>Month</th><th>Channel</th><th>Spent</th><th /></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{e.month.slice(0, 7)}</td>
                <td>{e.source}</td>
                <td>{e.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}</td>
                <td><button type="button" className="button-secondary" onClick={() => remove(e.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
