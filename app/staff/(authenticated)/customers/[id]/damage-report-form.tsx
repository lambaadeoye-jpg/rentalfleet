"use client";

import { useState } from "react";
import { generateDamageReport } from "./damage-report-actions";

export default function DamageReportForm({ rentalId }: { rentalId: string }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setResult(null);
    const res = await generateDamageReport(rentalId, description);
    setLoading(false);

    if (!res.success) {
      setResult({ success: false, message: res.error ?? "Couldn't generate the report." });
      return;
    }
    setResult({ success: true, message: "Damage report generated and sent to the renter." });
    setDescription("");
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="button-secondary" style={{ color: "var(--text)", borderColor: "var(--border)" }}>
        Generate Damage Report
      </button>
    );
  }

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <p className="muted-text" style={{ fontSize: 13, marginBottom: 8 }}>
        Pulls in whatever return-inspection photos were captured for this rental automatically.
      </p>
      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Describe the damage</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </label>
      {result && (
        <p style={{ fontSize: 13, marginBottom: 12, color: result.success ? "var(--signal-green, #16a34a)" : undefined }} className={result.success ? undefined : "error-text"}>
          {result.message}
        </p>
      )}
      <button onClick={handleGenerate} disabled={loading || !description.trim()} className="button-primary">
        {loading ? "Generating..." : "Generate & Send"}
      </button>
    </div>
  );
}
