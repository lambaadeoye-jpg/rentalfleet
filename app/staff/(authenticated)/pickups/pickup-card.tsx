"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { confirmPickup } from "../applications/rental-actions";
import type { PickupItem } from "./list-actions";

export default function PickupCard({ item }: { item: PickupItem }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [startMileage, setStartMileage] = useState("");
  const [agreementAcknowledged, setAgreementAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readyChecks = item.hasLicenseDocument && item.insuranceVerified;

  async function handleConfirmPickup() {
    if (!startMileage) {
      setError("Enter the starting mileage.");
      return;
    }
    if (!agreementAcknowledged) {
      setError("Confirm the agreement was walked through with the renter.");
      return;
    }

    // Critical action -- confirm before it actually happens, per explicit
    // requirement that field staff shouldn't be able to mistakenly trigger
    // a handover with one accidental tap.
    const confirmed = window.confirm(
      `Confirm handover to ${item.customerFirstName} ${item.customerLastName} for the ${item.vehicleLabel}? This cannot be undone from here.`
    );
    if (!confirmed) return;

    setError(null);
    setLoading(true);
    const result = await confirmPickup(item.rentalId, Number(startMileage), agreementAcknowledged);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't confirm pickup. Please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {item.customerFirstName} {item.customerLastName}
          </div>
          <div className="muted-text" style={{ fontSize: 13 }}>{item.vehicleLabel}</div>
        </div>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </div>

      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Pre-pickup checklist</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            <ChecklistRow ok={item.hasLicenseDocument} label="Driver's license on file" />
            <ChecklistRow ok={item.insuranceVerified} label="Insurance verified" />
          </div>

          {!readyChecks && (
            <p className="error-text" style={{ fontSize: 13, marginBottom: 12 }}>
              Resolve the items above before confirming pickup.
            </p>
          )}

          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Starting mileage</span>
            <input type="number" value={startMileage} onChange={(e) => setStartMileage(e.target.value)} />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 12, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={agreementAcknowledged}
              onChange={(e) => setAgreementAcknowledged(e.target.checked)}
            />
            I walked through the rental agreement and key policies with the renter
          </label>

          {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

          <button onClick={handleConfirmPickup} disabled={loading || !readyChecks} className="button-primary">
            {loading ? "Confirming..." : "Confirm Pickup"}
          </button>
        </div>
      )}
    </div>
  );
}

function ChecklistRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
      {ok ? <CheckCircle2 size={16} color="var(--signal-green, #16a34a)" /> : <XCircle size={16} color="var(--red, #dc2626)" />}
      {label}
    </div>
  );
}
