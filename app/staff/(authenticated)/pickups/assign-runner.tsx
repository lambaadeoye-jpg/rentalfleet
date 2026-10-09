"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { assignRunner } from "./assign-actions";
import type { RunnerOption } from "./list-actions";

export default function AssignRunner({ rentalId, current, runners }: { rentalId: string; current: string | null; runners: RunnerOption[] }) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setBusy(true);
    setError(null);
    const res = await assignRunner(rentalId, next || null);
    setBusy(false);
    if (!res.success) {
      setValue(previous);
      setError(res.error ?? "Couldn’t assign.");
      return;
    }
    router.refresh();
  }

  if (runners.length === 0) return <p className="muted-text" style={{ fontSize: 12, marginBottom: 12 }}>No runners yet. Invite one under Team with the field staff role.</p>;
  return (
    <label className="field" style={{ marginBottom: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Assigned runner</span>
      <select value={value} disabled={busy} onChange={(e) => change(e.target.value)}>
        <option value="">Unassigned</option>
        {runners.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
      {error && <span className="error-text" style={{ fontSize: 12 }}>{error}</span>}
    </label>
  );
}
