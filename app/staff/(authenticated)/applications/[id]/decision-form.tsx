"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { decideApplication } from "../actions";
import { DECISION_OUTCOMES } from "../constants";

const OUTCOME_LABELS: Record<(typeof DECISION_OUTCOMES)[number], string> = {
  approved: "Approve",
  conditionally_approved: "Conditionally Approve",
  declined: "Decline",
};

export default function DecisionForm({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pendingOutcome, setPendingOutcome] = useState<(typeof DECISION_OUTCOMES)[number] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDecide(outcome: (typeof DECISION_OUTCOMES)[number]) {
    if (outcome === "declined" && !reason.trim()) {
      setError("A reason is required to decline an application.");
      return;
    }
    setError(null);
    setPendingOutcome(outcome);

    const result = await decideApplication(applicationId, outcome, reason);

    setPendingOutcome(null);

    if (!result.success) {
      setError(result.error ?? "Couldn't save that decision. Please try again.");
      return;
    }

    router.refresh();
  }

  return (
    <div>
      <label className="field" style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          Reason <span className="muted-text">(required to decline, optional otherwise)</span>
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Why is this application being decided this way? Visible to the applicant if declined."
        />
      </label>

      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {DECISION_OUTCOMES.map((outcome) => (
          <button
            key={outcome}
            onClick={() => handleDecide(outcome)}
            disabled={pendingOutcome !== null}
            className={outcome === "declined" ? "button-secondary" : "button-primary"}
            style={
              outcome === "declined"
                ? { borderColor: "var(--red)", color: "var(--red)" }
                : undefined
            }
          >
            {pendingOutcome === outcome ? "Saving..." : OUTCOME_LABELS[outcome]}
          </button>
        ))}
      </div>

      <p className="muted-text" style={{ fontSize: 12, marginTop: 10 }}>
        This action requires the approve_driver permission and is enforced by the database, not
        just this screen.
      </p>
    </div>
  );
}
