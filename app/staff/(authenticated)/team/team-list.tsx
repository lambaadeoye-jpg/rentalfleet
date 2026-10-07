"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, X } from "lucide-react";
import { revokeInvite } from "./actions";
import type { StaffMember, PendingInvite } from "./actions";
import { sentenceCase } from "@/lib/format-label";

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
      <h2 className="card-title">Active staff</h2>
      <div className="card" style={{ padding: 0, marginBottom: 24, overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              {["Name", "Email", "Role"].map((h) => (
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
                <td>{sentenceCase(s.role_name)}</td>
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
