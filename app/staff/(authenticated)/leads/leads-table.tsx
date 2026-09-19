"use client";

import { useState } from "react";
import { updateLeadStage } from "./actions";

type Lead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  stage: string;
  source: string | null;
  created_at: string;
  platforms: string[];
};

const STAGE_LABELS: Record<string, string> = {
  new: "New",
  attempting_contact: "Attempting Contact",
  contacted: "Contacted",
  qualified: "Qualified",
  application_invited: "Application Invited",
  application_started: "Application Started",
  application_submitted: "Application Submitted",
  screening: "Screening",
  approved: "Approved",
  booking: "Booking",
  converted: "Converted",
};

export default function LeadsTable({ leads, stages }: { leads: Lead[]; stages: string[] }) {
  const [rows, setRows] = useState(leads);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function handleStageChange(leadId: string, newStage: string) {
    setSavingId(leadId);
    const result = await updateLeadStage(leadId, newStage);
    setSavingId(null);

    if (!result.success) {
      alert(result.error ?? "Couldn't update that lead's stage. Please try again.");
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === leadId ? { ...r, stage: newStage } : r)));
  }

  if (rows.length === 0) {
    return <p className="muted-text">No leads yet.</p>;
  }

  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
            {["Name", "Contact", "Driving For", "Source", "Stage", "Received"].map((h) => (
              <th key={h} style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)", fontWeight: 700 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((lead) => (
            <tr key={lead.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                {lead.first_name} {lead.last_name}
              </td>
              <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>
                <div>{lead.phone}</div>
                {lead.email && <div style={{ fontSize: 12 }}>{lead.email}</div>}
              </td>
              <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>
                {lead.platforms.length > 0 ? lead.platforms.join(", ") : "—"}
              </td>
              <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>{lead.source ?? "—"}</td>
              <td style={{ padding: "12px 16px" }}>
                <select
                  value={lead.stage}
                  disabled={savingId === lead.id}
                  onChange={(e) => handleStageChange(lead.id, e.target.value)}
                  style={{ fontSize: 13, padding: "6px 8px" }}
                >
                  {stages.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABELS[s] ?? s}
                    </option>
                  ))}
                </select>
              </td>
              <td style={{ padding: "12px 16px", color: "var(--text-secondary)", fontSize: 13 }}>
                {new Date(lead.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
