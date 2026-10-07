"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { confirmPickup, setPickupAppointment, resolvePickupFollowup, type PickupLocationOption } from "../applications/rental-actions";
import RentalMoneyPanel from "./rental-money-panel";
import InspectionPhotoUpload from "./inspection-photo-upload";
import type { PickupItem } from "./list-actions";

export default function PickupCard({ item, locations }: { item: PickupItem; locations: PickupLocationOption[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [startMileage, setStartMileage] = useState("");
  const [agreementAcknowledged, setAgreementAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const readyChecks = item.hasLicenseDocument && item.insuranceVerified;

  const [followupLoading, setFollowupLoading] = useState(false);
  const [followupError, setFollowupError] = useState<string | null>(null);
  const outcomeLabels: Record<string, string> = {
    needs_reschedule: "Renter wants to reschedule",
    cannot_make_it: "Renter can’t make it",
    needs_help_from_staff: "Renter asked for help from a person",
    no_answer: "No answer",
    voicemail: "Voicemail left",
    confirmed: "Confirmed",
  };
  async function handleResolveFollowup() {
    setFollowupError(null);
    setFollowupLoading(true);
    const result = await resolvePickupFollowup(item.rentalId);
    setFollowupLoading(false);
    if (!result.success) {
      setFollowupError(result.error ?? "Couldn’t mark that as handled.");
      return;
    }
    router.refresh();
  }

  // datetime-local wants "YYYY-MM-DDTHH:mm" in the browser’s local time.
  const toLocalInput = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [apptAt, setApptAt] = useState(toLocalInput(item.pickupAt));
  const [returnAt, setReturnAt] = useState(item.dropOffManuallySet ? toLocalInput(item.expectedReturnAt) : "");
  const [apptLocation, setApptLocation] = useState(item.pickupLocationId ?? "");
  const [apptLoading, setApptLoading] = useState(false);
  const [apptError, setApptError] = useState<string | null>(null);
  const [apptSaved, setApptSaved] = useState(false);

  async function handleSaveAppointment() {
    if (!apptAt || !apptLocation) {
      setApptError("Choose a pickup date/time and a location.");
      return;
    }
    setApptError(null);
    setApptSaved(false);
    setApptLoading(true);
    const result = await setPickupAppointment(item.rentalId, new Date(apptAt).toISOString(), returnAt ? new Date(returnAt).toISOString() : null, apptLocation);
    setApptLoading(false);
    if (!result.success) {
      setApptError(result.error ?? "Couldn’t save the appointment.");
      return;
    }
    setApptSaved(true);
    router.refresh();
  }

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
    // requirement that field staff shouldn’t be able to mistakenly trigger
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
      // Surfaces the payment-gate error too -- "Record a payment/deposit
      // before confirming pickup" -- if nothing’s been recorded yet.
      setError(result.error ?? "Couldn’t confirm pickup. Please try again.");
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
            {item.followup.needed && (
              <span
                style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fef3c7", color: "#92400e" }}
              >
                Needs follow-up
              </span>
            )}
          </div>
          <div className="muted-text" style={{ fontSize: 13 }}>{item.vehicleLabel}</div>
          <div className="muted-text" style={{ fontSize: 13 }}>
            {item.pickupAt
              ? `Pickup: ${new Date(item.pickupAt).toLocaleString()}${item.pickupConfirmedAt ? " (confirmed by renter)" : ""}${item.expectedReturnAt ? ` · Drop-off: ${new Date(item.expectedReturnAt).toLocaleString()}` : ""}`
              : "No pickup appointment set"}
          </div>
        </div>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </div>

      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          {item.followup.needed && (
            <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                {item.followup.outcome ? outcomeLabels[item.followup.outcome] ?? item.followup.outcome : "Needs follow-up"}
                {item.followup.at ? ` · ${new Date(item.followup.at).toLocaleString()}` : ""}
              </p>
              {item.followup.summary && <p style={{ fontSize: 13, marginBottom: 4 }}>{item.followup.summary}</p>}
              {item.followup.committedTime && (
                <p style={{ fontSize: 13, marginBottom: 4 }}>Renter mentioned: {item.followup.committedTime}</p>
              )}
              {followupError && <p className="error-text" style={{ fontSize: 13, marginBottom: 8 }}>{followupError}</p>}
              <button
                onClick={handleResolveFollowup}
                disabled={followupLoading}
                className="button-secondary"
                style={{ color: "var(--text)", borderColor: "var(--border)", marginTop: 4 }}
              >
                {followupLoading ? "Saving..." : "Mark as handled"}
              </button>
            </div>
          )}
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Pickup appointment</p>
          <div className="form-row" style={{ marginBottom: 8 }}>
            <label className="field">
              <span style={{ fontSize: 13, fontWeight: 600 }}>Date &amp; time</span>
              <input
                type="datetime-local"
                value={apptAt}
                onChange={(e) => {
                  setApptAt(e.target.value);
                }}
              />
            </label>
            <label className="field">
              <span style={{ fontSize: 13, fontWeight: 600 }}>Drop-off (optional, min. 7 days)</span>
              <input type="datetime-local" value={returnAt} onChange={(e) => setReturnAt(e.target.value)} />
              <span className="muted-text" style={{ fontSize: 12 }}>
                {returnAt ? "Set by staff." : "Leave blank: automatically 7 days after pickup."}
              </span>
            </label>
            <label className="field">
              <span style={{ fontSize: 13, fontWeight: 600 }}>Location</span>
              <select value={apptLocation} onChange={(e) => setApptLocation(e.target.value)}>
                <option value="">Choose...</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>
          </div>
          {apptError && <p className="error-text" style={{ fontSize: 13, marginBottom: 8 }}>{apptError}</p>}
          {apptSaved && <p style={{ color: "var(--signal-green, #16a34a)", fontSize: 13, marginBottom: 8 }}>Appointment saved.</p>}
          <button
            onClick={handleSaveAppointment}
            disabled={apptLoading}
            className="button-secondary"
            style={{ color: "var(--text)", borderColor: "var(--border)", marginBottom: 20 }}
          >
            {apptLoading ? "Saving..." : item.pickupAt ? "Update appointment" : "Set appointment"}
          </button>

          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Pre-pickup checklist</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            <ChecklistRow ok={item.hasLicenseDocument} label="Driver’s license on file" />
            <ChecklistRow ok={item.insuranceVerified} label="Insurance verified" />
          </div>

          {!readyChecks && (
            <p className="error-text" style={{ fontSize: 13, marginBottom: 12 }}>
              Resolve the items above before confirming pickup.
            </p>
          )}

          <RentalMoneyPanel rentalId={item.rentalId} money={item.money} />

          <InspectionPhotoUpload rentalId={item.rentalId} vehicleId={item.vehicleId} inspectionType="pickup" />

          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            Confirm handover
          </p>

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
            {loading ? "Confirming..." : "Confirm pickup"}
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
