"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy } from "lucide-react";
import { createSupportTicket } from "../../actions";

type Ticket = { id: string; subject: string; status: string; created_at: string };

export default function SupportTicketForm({ initialTickets }: { initialTickets: Ticket[] }) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!subject.trim()) {
      setError("Enter what you need help with.");
      return;
    }
    setError(null);
    setLoading(true);
    const result = await createSupportTicket(subject);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't submit. Please try again.");
      return;
    }
    setSubject("");
    router.refresh();
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>What do you need help with?</h2>
        <textarea
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          rows={3}
          placeholder="e.g. My payment didn't go through"
          style={{ marginBottom: 10 }}
        />
        {error && <p className="error-text" style={{ marginBottom: 10 }}>{error}</p>}
        <button onClick={handleSubmit} disabled={loading} className="button-primary" style={{ width: "100%" }}>
          {loading ? "Submitting..." : "Submit Request"}
        </button>
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Your Requests</h2>
      {initialTickets.length === 0 ? (
        <p className="muted-text">No requests yet.</p>
      ) : (
        initialTickets.map((t) => (
          <div key={t.id} className="card" style={{ marginBottom: 10, display: "flex", alignItems: "flex-start", gap: 10 }}>
            <LifeBuoy size={16} color="var(--teal)" style={{ marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t.subject}</div>
              <div className="muted-text" style={{ fontSize: 12, textTransform: "capitalize" }}>
                {t.status} • {new Date(t.created_at).toLocaleDateString()}
              </div>
            </div>
          </div>
        ))
      )}
    </>
  );
}
