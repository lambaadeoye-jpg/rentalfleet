"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { addRedFlagEntry, resolveRedFlagEntry, type RedFlagEntry, type FlaggedLead } from "./actions";
import { sentenceCase } from "@/lib/format-label";
import { formatPhone } from "@/lib/format-phone";

export default function RedFlagManager({
  initialEntries,
  flaggedLeads,
}: {
  initialEntries: RedFlagEntry[];
  flaggedLeads: FlaggedLead[];
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  async function handleAdd() {
    setError(null);
    setLoading(true);
    const result = await addRedFlagEntry({ firstName, lastName, phone, email, reason });
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn’t add that entry.");
      return;
    }
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    setReason("");
    router.refresh();
  }

  async function handleResolve(entryId: string) {
    const note = window.prompt("Optional note on why this is being resolved:");
    if (note === null) return; // cancelled
    setResolvingId(entryId);
    const result = await resolveRedFlagEntry(entryId, note);
    setResolvingId(null);

    if (!result.success) {
      setError(result.error ?? "Couldn’t resolve that entry.");
      return;
    }
    router.refresh();
  }

  const activeEntries = initialEntries.filter((e) => e.status === "active");
  const resolvedEntries = initialEntries.filter((e) => e.status !== "active");

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 className="card-title">Add an entry</h2>
        <div className="form-row">
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>First name</span>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Last name</span>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Reason *</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="What happened, and when" />
        </label>
        {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
        <button onClick={handleAdd} disabled={loading || !reason.trim()} className="button-primary">
          {loading ? "Adding..." : "Add to red flag list"}
        </button>
      </div>

      {flaggedLeads.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderColor: "var(--warning, #f59e0b)" }}>
          <h2 style={{ fontSize: 16, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={18} color="var(--warning, #f59e0b)" /> Leads that matched
          </h2>
          {flaggedLeads.map((l) => (
            <div key={l.id} style={{ fontSize: 14, marginBottom: 8 }}>
              <strong>
                {l.firstName} {l.lastName}
              </strong>{" "}
              — {formatPhone(l.phone)} —{" "}
              <span>{sentenceCase(l.matchType.replace(/_/g, " "))}</span> match —{" "}
              {new Date(l.createdAt).toLocaleDateString()}
            </div>
          ))}
        </div>
      )}

      <h2 className="card-title">Active entries</h2>
      {activeEntries.length === 0 && <p className="muted-text" style={{ fontSize: 14, marginBottom: 20 }}>None yet.</p>}
      {activeEntries.map((e) => (
        <div key={e.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700 }}>
              {e.firstName} {e.lastName} {e.phone && `— ${formatPhone(e.phone)}`} {e.email && `— ${e.email}`}
            </div>
            <div className="muted-text" style={{ fontSize: 13, marginTop: 4 }}>{e.reason}</div>
          </div>
          <button
            onClick={() => handleResolve(e.id)}
            disabled={resolvingId === e.id}
            className="button-secondary"
            style={{ color: "var(--text)", borderColor: "var(--border)" }}
          >
            {resolvingId === e.id ? "Resolving..." : "Resolve"}
          </button>
        </div>
      ))}

      {resolvedEntries.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, marginTop: 24, marginBottom: 12 }}>Resolved</h2>
          {resolvedEntries.map((e) => (
            <div key={e.id} className="card" style={{ marginBottom: 8, opacity: 0.6 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {e.firstName} {e.lastName}
              </div>
              <div className="muted-text" style={{ fontSize: 13 }}>{e.reason}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
