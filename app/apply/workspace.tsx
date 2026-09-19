"use client";

import { useState } from "react";
import { User, IdCard, Briefcase, ShieldCheck, ClipboardCheck, Check, Phone } from "lucide-react";
import DocumentUpload from "./document-upload";
import { PHONE_DISPLAY, PHONE_TEL } from "@/lib/site-config";
import {
  type ApplicationData,
  savePersonalStep,
  saveLicenseStep,
  saveWorkStep,
  saveInsuranceStep,
  submitApplication,
} from "./actions";

type GigPlatform = { id: string; code: string; name: string };

const STEPS = [
  { key: "personal", label: "Personal", icon: User },
  { key: "license", label: "License", icon: IdCard },
  { key: "work", label: "Work", icon: Briefcase },
  { key: "insurance", label: "Insurance", icon: ShieldCheck },
  { key: "review", label: "Review", icon: ClipboardCheck },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

export default function Workspace({
  data,
  platforms,
}: {
  data: ApplicationData;
  platforms: GigPlatform[];
}) {
  const [step, setStep] = useState<StepKey>(
    data.applicationStatus === "submitted" || data.applicationStatus === "screening" ? "review" : "personal"
  );
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(data.applicationStatus !== "draft");

  // Local copies so each step can edit before saving, without re-fetching.
  const [firstName, setFirstName] = useState(data.firstName);
  const [lastName, setLastName] = useState(data.lastName);
  const [phone, setPhone] = useState(data.phone);
  const [licenseState, setLicenseState] = useState(data.licenseState);
  const [licenseNumberRef, setLicenseNumberRef] = useState(data.licenseNumberRef);
  const [gigPlatformIds, setGigPlatformIds] = useState<string[]>(data.gigPlatformIds);
  const [insuranceProvider, setInsuranceProvider] = useState(data.insuranceProvider);
  const [insurancePolicyReference, setInsurancePolicyReference] = useState(data.insurancePolicyReference);

  function togglePlatform(id: string) {
    setGigPlatformIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
    setSavedAt(null);
  }

  function goTo(next: StepKey) {
    setStep(next);
    setSavedAt(null);
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  async function handleContinue() {
    let result: { success: boolean; error?: string } = { success: true };

    if (step === "personal") {
      result = await savePersonalStep(data.customerId, { firstName, lastName, phone });
    } else if (step === "license") {
      result = await saveLicenseStep(data.customerId, { licenseState, licenseNumberRef });
    } else if (step === "work") {
      result = await saveWorkStep(data.customerId, gigPlatformIds);
    } else if (step === "insurance") {
      result = await saveInsuranceStep(data.customerId, {
        provider: insuranceProvider,
        policyReference: insurancePolicyReference,
      });
    }

    if (!result.success) {
      alert(result.error ?? "Couldn't save that step. Please try again.");
      return;
    }

    setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    const next = STEPS[stepIndex + 1];
    if (next) goTo(next.key);
  }

  async function handleSubmitApplication() {
    const result = await submitApplication(data.applicationId);
    if (!result.success) {
      alert(result.error ?? "Couldn't submit. Please try again.");
      return;
    }
    setSubmitted(true);
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "40px 20px 120px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Let&apos;s get you approved.</h1>
      <p className="muted-text" style={{ marginBottom: 8 }}>
        We just need a few more details to determine your eligibility. Your progress is saved
        automatically as you go — leave anytime and pick up where you left off.
      </p>
      {step !== "review" && (
        <p className="muted-text" style={{ marginBottom: 24, fontSize: 13, fontWeight: 600 }}>
          Step {stepIndex + 1} of {STEPS.length}
        </p>
      )}

      {/* Progress steps */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isDone = i < stepIndex || submitted;
          const isActive = s.key === step;
          return (
            <button
              key={s.key}
              onClick={() => goTo(s.key)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                background: "none",
                border: "none",
                cursor: "pointer",
                opacity: isActive ? 1 : 0.55,
                flex: 1,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: isDone ? "var(--teal)" : isActive ? "var(--midnight)" : "var(--border)",
                  color: isDone || isActive ? "white" : "var(--text-secondary)",
                }}
              >
                {isDone ? <Check size={16} /> : <Icon size={16} />}
              </div>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{s.label}</span>
            </button>
          );
        })}
      </div>

      <div className="card">
        {step === "personal" && (
          <>
            <h2 style={{ fontSize: 18, marginBottom: 16 }}>What&apos;s your legal name?</h2>
            <div className="form-row">
              <label className="field">
                <span style={{ fontSize: 13, fontWeight: 600 }}>First name</span>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </label>
              <label className="field">
                <span style={{ fontSize: 13, fontWeight: 600 }}>Last name</span>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </label>
            </div>
            <label className="field">
              <span style={{ fontSize: 13, fontWeight: 600 }}>Mobile phone</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" required />
            </label>
          </>
        )}

        {step === "license" && (
          <>
            <h2 style={{ fontSize: 18, marginBottom: 4 }}>Driver&apos;s license</h2>
            <p className="muted-text" style={{ fontSize: 13, marginBottom: 16 }}>
              We ask for this to confirm your identity and keep your application moving — it&apos;s
              never shared beyond what your application requires.
            </p>
            <div className="form-row">
              <label className="field">
                <span style={{ fontSize: 13, fontWeight: 600 }}>License state</span>
                <input value={licenseState} onChange={(e) => setLicenseState(e.target.value)} placeholder="TN" />
              </label>
              <label className="field">
                <span style={{ fontSize: 13, fontWeight: 600 }}>License number</span>
                <input value={licenseNumberRef} onChange={(e) => setLicenseNumberRef(e.target.value)} />
              </label>
            </div>
            <DocumentUpload customerId={data.customerId} documentType="drivers_license" label="Upload driver's license" />
            <DocumentUpload
              customerId={data.customerId}
              documentType="proof_of_residence"
              label="Upload proof of residence"
            />
          </>
        )}

        {step === "work" && (
          <>
            <h2 style={{ fontSize: 18, marginBottom: 4 }}>What are you driving for?</h2>
            <p className="muted-text" style={{ marginBottom: 16 }}>Select all that apply.</p>
            <div className="checkbox-grid">
              {platforms.map((p) => (
                <label key={p.id} className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={gigPlatformIds.includes(p.id)}
                    onChange={() => togglePlatform(p.id)}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </>
        )}

        {step === "insurance" && (
          <>
            <h2 style={{ fontSize: 18, marginBottom: 4 }}>Insurance information</h2>
            <p className="muted-text" style={{ fontSize: 13, marginBottom: 16 }}>
              We ask so we can confirm you&apos;re covered before you drive — bring your own
              policy, or ask us about options once you&apos;re approved.
            </p>
            <div className="form-row">
              <label className="field">
                <span style={{ fontSize: 13, fontWeight: 600 }}>Insurance provider</span>
                <input value={insuranceProvider} onChange={(e) => setInsuranceProvider(e.target.value)} />
              </label>
              <label className="field">
                <span style={{ fontSize: 13, fontWeight: 600 }}>Policy number</span>
                <input
                  value={insurancePolicyReference}
                  onChange={(e) => setInsurancePolicyReference(e.target.value)}
                />
              </label>
            </div>
            <DocumentUpload customerId={data.customerId} documentType="insurance_card" label="Upload insurance card" />
          </>
        )}

        {step === "review" && (
          <>
            <h2 style={{ fontSize: 18, marginBottom: 16 }}>Review &amp; submit</h2>
            {submitted ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <Check size={40} color="var(--teal)" style={{ marginBottom: 12 }} />
                <p style={{ fontWeight: 700, marginBottom: 4 }}>Application submitted</p>
                <p className="muted-text" style={{ marginBottom: 4 }}>
                  You&apos;ll get an automatic confirmation within minutes. From there, many
                  applicants complete the full process in under 24 hours when everything&apos;s
                  submitted promptly.
                </p>
              </div>
            ) : (
              <>
                <ul style={{ paddingLeft: 18, color: "var(--text-secondary)", fontSize: 14, marginBottom: 12 }}>
                  <li>
                    {firstName} {lastName} — {phone}
                  </li>
                  <li>License: {licenseState} {licenseNumberRef || "(not yet provided)"}</li>
                  <li>
                    Platforms:{" "}
                    {platforms
                      .filter((p) => gigPlatformIds.includes(p.id))
                      .map((p) => p.name)
                      .join(", ") || "(none selected)"}
                  </li>
                  <li>Insurance: {insuranceProvider || "(not yet provided)"}</li>
                </ul>
                <p className="muted-text" style={{ fontSize: 13, marginBottom: 20 }}>
                  Submitting doesn&apos;t charge you anything — we&apos;ll always show you the
                  exact cost before you pay.
                </p>
                <button onClick={handleSubmitApplication} className="button-primary" style={{ width: "100%" }}>
                  Submit application
                </button>
              </>
            )}
          </>
        )}

        {step !== "review" && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24 }}>
            <span className="muted-text" style={{ fontSize: 13 }}>
              {savedAt ? `Saved at ${savedAt}` : ""}
            </span>
            <button onClick={handleContinue} className="button-primary">
              Continue
            </button>
          </div>
        )}
      </div>

      {/* Visible help access -- previously nowhere in the Application
          Workspace, meaning someone stuck mid-application (confused field,
          failed upload) had no way to get help without abandoning the flow
          and navigating back to the homepage. */}
      <p className="muted-text" style={{ textAlign: "center", marginTop: 24, fontSize: 13 }}>
        Stuck on something?{" "}
        <a href={`tel:${PHONE_TEL}`} style={{ color: "var(--teal)", fontWeight: 700 }}>
          <Phone size={13} style={{ verticalAlign: "-2px", marginRight: 3 }} />
          Call {PHONE_DISPLAY}
        </a>{" "}
        and we&apos;ll walk you through it.
      </p>
    </div>
  );
}
