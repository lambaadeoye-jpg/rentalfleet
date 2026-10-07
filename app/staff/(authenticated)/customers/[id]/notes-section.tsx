"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addCustomerNote, type CustomerNote } from "./notes-actions";

export default function NotesSection({ customerId, initialNotes }: { customerId: string; initialNotes: CustomerNote[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    setError(null);
    setSubmitting(true);
    const result = await addCustomerNote(customerId, body);
    setSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "Couldn’t add that note.");
      return;
    }
    setBody("");
    router.refresh();
  }

  return (
    <div>
      {!initialNotes.length && (
        <div style={{ padding: "16px", color: "var(--text-secondary)", fontSize: 14 }}>No notes yet.</div>
      )}
      {initialNotes.map((n) => (
        <div key={n.id} style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
          <div style={{ marginBottom: 4 }}>{n.body}</div>
          <div className="muted-text" style={{ fontSize: 12 }}>
            {n.authorName ?? "Unknown staff"} · {new Date(n.createdAt).toLocaleString()}
          </div>
        </div>
      ))}
      <div style={{ padding: 16 }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="E.g. background check cleared, insurance verified, license confirmed valid..."
          style={{ width: "100%", marginBottom: 8 }}
        />
        {error && <p className="error-text" style={{ marginBottom: 8, fontSize: 13 }}>{error}</p>}
        <button onClick={handleAdd} disabled={submitting || !body.trim()} className="button-primary">
          {submitting ? "Adding..." : "Add note"}
        </button>
      </div>
    </div>
  );
}
