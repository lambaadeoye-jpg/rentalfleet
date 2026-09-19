"use client";

import { useState } from "react";
import { updateInsuranceStatus } from "./actions";
import { INSURANCE_STATUSES, STATUS_LABELS, STATUS_COLOR } from "./constants";

type Row = {
  id: string;
  provider: string | null;
  policy_reference: string | null;
  effective_to: string | null;
  verification_status: string;
  verified_at: string | null;
  customerName: string;
};

export default function InsuranceTable({ rows }: { rows: Row[] }) {
  const [data, setData] = useState(rows);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<string>("all");

  async function handleStatusChange(id: string, newStatus: string) {
    setSavingId(id);
    setErrorById((prev) => ({ ...prev, [id]: "" }));

    const result = await updateInsuranceStatus(id, newStatus);
    setSavingId(null);

    if (!result.success) {
      setErrorById((prev) => ({ ...prev, [id]: result.error ?? "Couldn't update." }));
      return;
    }
    setData((prev) =>
      prev.map((r) => (r.id === id ? { ...r, verification_status: newStatus, verified_at: new Date().toISOString() } : r))
    );
  }

  const filtered = filter === "all" ? data : data.filter((r) => r.verification_status === filter);

  if (data.length === 0) {
    return <p className="muted-text">No insurance policies on file yet -- these come from the Application Workspace's Insurance step.</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button
          onClick={() => setFilter("all")}
          className={filter === "all" ? "button-primary" : "button-secondary"}
          style={filter !== "all" ? { color: "var(--text)", borderColor: "var(--border)" } : undefined}
        >
          All
        </button>
        {INSURANCE_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={filter === s ? "button-primary" : "button-secondary"}
            style={filter !== s ? { color: "var(--text)", borderColor: "var(--border)", fontSize: 13 } : { fontSize: 13 }}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
              {["Customer", "Provider", "Expires", "Last Verified", "Status"].map((h) => (
                <th key={h} style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)", fontWeight: 700 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "12px 16px", fontWeight: 600 }}>{r.customerName}</td>
                <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>
                  {r.provider ?? "—"}
                  {r.policy_reference && (
                    <div style={{ fontSize: 12 }}>{r.policy_reference}</div>
                  )}
                </td>
                <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>
                  {r.effective_to ? new Date(r.effective_to).toLocaleDateString() : "—"}
                </td>
                <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>
                  {r.verified_at ? new Date(r.verified_at).toLocaleDateString() : "Never"}
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <select
                    value={r.verification_status}
                    disabled={savingId === r.id}
                    onChange={(e) => handleStatusChange(r.id, e.target.value)}
                    style={{ fontSize: 13, padding: "6px 8px", color: STATUS_COLOR[r.verification_status], fontWeight: 700 }}
                  >
                    {INSURANCE_STATUSES.map((s) => (
                      <option key={s} value={s} style={{ color: "var(--text)", fontWeight: 400 }}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  {errorById[r.id] && (
                    <p className="error-text" style={{ fontSize: 12, marginTop: 4 }}>
                      {errorById[r.id]}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
