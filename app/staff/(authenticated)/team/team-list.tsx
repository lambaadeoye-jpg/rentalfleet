"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, X } from "lucide-react";
import { revokeInvite, removeStaffMember, changeStaffRole } from "./actions";
import type { StaffMember, PendingInvite } from "./actions";
import { sentenceCase } from "@/lib/format-label";

export default function TeamList({ staff, invites, roles = [] }: { staff: StaffMember[]; invites: PendingInvite[]; roles?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke(id: string) {
    setRevokingId(id);
    setError(null);
    try {
      const res = await revokeInvite(id);
      if (!res.success) setError(res.error ?? "Couldn’t revoke that invite.");
    } catch {
      setError("Couldn’t revoke that invite. Please try again.");
    }
    setRevokingId(null);
    router.refresh();
  }

  async function handleRemove(s: StaffMember) {
    if (!window.confirm(`Remove ${s.full_name ?? s.email} from the team? They will lose access to the staff area right away.`)) return;
    setBusyUser(s.user_id);
    setError(null);
    try {
      const res = await removeStaffMember(s.user_id);
      if (!res.success) setError(res.error ?? "Couldn’t remove that person.");
    } catch {
      setError("Couldn’t remove that person. Please try again.");
    }
    setBusyUser(null);
    router.refresh();
  }

  async function handleRole(s: StaffMember, roleId: string) {
    if (!roleId) return;
    const roleName = roles.find((r) => r.id === roleId)?.name ?? "that role";
    if (!window.confirm(`Change ${s.full_name ?? s.email} to ${sentenceCase(roleName).toLowerCase()}?`)) { router.refresh(); return; }
    setBusyUser(s.user_id);
    setError(null);
    try {
      const res = await changeStaffRole(s.user_id, roleId);
      if (!res.success) setError(res.error ?? "Couldn’t change the role.");
    } catch {
      setError("Couldn’t change the role. Please try again.");
    }
    setBusyUser(null);
    router.refresh();
  }

  return (
    <div>
      {error && <p className="error-text" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      <h2 className="card-title">Active staff</h2>
      <div className="card" style={{ padding: 0, marginBottom: 24, overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              {["Name", "Email", "Role", ""].map((h) => (
                <th key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.user_id}>
                <td className="cell-strong">{s.full_name ?? "—"}</td>
                <td className="cell-muted">{s.email}</td>
                <td>
                  {roles.length > 0 ? (
                    <select
                      aria-label={`Role for ${s.full_name ?? s.email}`}
                      value={roles.find((r) => r.name === s.role_name)?.id ?? ""}
                      disabled={busyUser === s.user_id}
                      onChange={(e) => handleRole(s, e.target.value)}
                      style={{ minWidth: 140 }}
                    >
                      {roles.map((r) => <option key={r.id} value={r.id}>{sentenceCase(r.name)}</option>)}
                    </select>
                  ) : sentenceCase(s.role_name)}
                </td>
                <td>
                  <button className="button-secondary" disabled={busyUser === s.user_id} onClick={() => handleRemove(s)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invites.length > 0 && (
        <>
          <h2 className="card-title">Pending invites</h2>
          {invites.map((i) => (
            <div key={i.id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Mail size={16} color="var(--teal)" />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{i.email}</div>
                  <div className="muted-text" style={{ fontSize: 12 }}>
                    {sentenceCase(i.role_name)} • sent {new Date(i.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleRevoke(i.id)}
                disabled={revokingId === i.id}
                aria-label="Revoke invite"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
              >
                <X size={16} color="var(--text-secondary)" />
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
