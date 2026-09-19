"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, X } from "lucide-react";
import { revokeInvite } from "./actions";
import type { StaffMember, PendingInvite } from "./actions";

export default function TeamList({ staff, invites }: { staff: StaffMember[]; invites: PendingInvite[] }) {
  const router = useRouter();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleRevoke(id: string) {
    setRevokingId(id);
    await revokeInvite(id);
    setRevokingId(null);
    router.refresh();
  }

  return (
    <div>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Active Staff</h2>
      <div className="card" style={{ padding: 0, marginBottom: 24, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
              {["Name", "Email", "Role"].map((h) => (
                <th key={h} style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)", fontWeight: 700 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.user_id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "12px 16px", fontWeight: 600 }}>{s.full_name ?? "—"}</td>
                <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>{s.email}</td>
                <td style={{ padding: "12px 16px", textTransform: "capitalize" }}>{s.role_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invites.length > 0 && (
        <>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Pending Invites</h2>
          {invites.map((i) => (
            <div key={i.id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Mail size={16} color="var(--teal)" />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{i.email}</div>
                  <div className="muted-text" style={{ fontSize: 12, textTransform: "capitalize" }}>
                    {i.role_name} • sent {new Date(i.created_at).toLocaleDateString()}
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
