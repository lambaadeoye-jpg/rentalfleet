"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { inviteStaffMember } from "./actions";

type Role = { id: string; name: string };

export default function InviteForm({ roles }: { roles: Role[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const result = await inviteStaffMember(
      String(form.get("email") || ""),
      String(form.get("roleId") || "")
    );

    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't send that invite. Please try again.");
      return;
    }

    setOpen(false);
    (e.target as HTMLFormElement).reset();
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="button-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Plus size={16} />
        Invite Staff Member
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 480 }}>
      <h2 style={{ fontSize: 16, marginBottom: 16 }}>Invite a staff member</h2>

      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Email</span>
        <input name="email" type="email" required />
      </label>

      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Role</span>
        <select name="roleId" required defaultValue="">
          <option value="" disabled>
            Select a role
          </option>
          {roles.map((r) => (
            <option key={r.id} value={r.id} style={{ textTransform: "capitalize" }}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

      <div style={{ display: "flex", gap: 10 }}>
        <button type="submit" className="button-primary" disabled={loading}>
          {loading ? "Sending..." : "Send Invite"}
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={() => setOpen(false)}
          disabled={loading}
          style={{ color: "var(--text)", borderColor: "var(--border)" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
