"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Phone, Mail, MessageSquare } from "lucide-react";
import { submitLead } from "../actions";
import { PHONE_DISPLAY } from "@/lib/site-config";
import { splitFullName } from "@/lib/split-full-name";

type Step = "license" | "driving" | "urgency" | "contact";
const STEPS: Step[] = ["license", "driving", "urgency", "contact"];

type DrivingStatus = "already_driving" | "ready_to_start" | "no";
type Urgency = "today" | "this_week" | "within_2_weeks" | "just_checking";

export default function GetStartedFlow() {
  const searchParams = useSearchParams();
  const referralCode = searchParams.get("ref") ?? undefined;

  const [stepIndex, setStepIndex] = useState(0);
  const [hasLicense, setHasLicense] = useState<boolean | null>(null);
  const [drivingStatus, setDrivingStatus] = useState<DrivingStatus | null>(null);
  const [urgency, setUrgency] = useState<Urgency | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const step = STEPS[stepIndex];
  const progress = Math.round(((stepIndex + 1) / STEPS.length) * 100);

  function canAdvance(): boolean {
    if (step === "license") return hasLicense !== null;
    if (step === "driving") return drivingStatus !== null;
    if (step === "urgency") return urgency !== null;
    return true;
  }

  function goNext() {
    if (stepIndex < STEPS.length - 1) setStepIndex(stepIndex + 1);
  }

  function goBack() {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  }

  async function handleSubmit() {
    const fullNameTrimmed = fullName.trim();
    const emailTrimmed = email.trim();
    const phoneTrimmed = phone.trim();

    if (!fullNameTrimmed || !emailTrimmed || !phoneTrimmed) {
      setError("Full name, email, and phone are required.");
      return;
    }

    // Single "Full Name" field, matching the benchmark -- split into
    // first/last here since that's still what submitLead()/the lead
    // table actually store.
    const { firstName: firstNameTrimmed, lastName: lastNameTrimmed } = splitFullName(fullNameTrimmed);

    setError(null);
    setLoading(true);
    try {
      const result = await submitLead({
        firstName: firstNameTrimmed,
        lastName: lastNameTrimmed || firstNameTrimmed,
        phone: phoneTrimmed,
        email: emailTrimmed,
        otherPlatformDetail: "",
        preferredCategoryId: null,
        pickupDate: null,
        rentalOption: "weekly",
        additionalInfo: "",
        gigPlatformIds: [],
        referralCode,
        hasDriversLicense: hasLicense ?? undefined,
        drivingStatus: drivingStatus ?? undefined,
        urgency: urgency ?? undefined,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
          <CheckCircle2 size={56} color="var(--teal)" style={{ marginBottom: 16 }} />
          <p
            style={{
              display: "inline-block",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.5,
              color: "var(--signal-green, #16a34a)",
              background: "rgba(22,163,74,0.1)",
              borderRadius: 999,
              padding: "4px 12px",
              marginBottom: 16,
            }}
          >
            APPLICATION RECEIVED
          </p>
          <h1 style={{ fontSize: 30, marginBottom: 12 }}>Thanks — you&apos;re all set.</h1>
          <p className="muted-text" style={{ fontSize: 16, marginBottom: 32 }}>
            We&apos;ve got your info. <strong>A member of our team will call you shortly</strong> to go
            over the next steps and get you on the road.
          </p>

          <div className="card" style={{ textAlign: "left" }}>
            <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--teal)", marginBottom: 16 }}>
              WHAT HAPPENS NEXT
            </p>
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <Phone size={20} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ fontWeight: 700, marginBottom: 2 }}>We&apos;ll call you</p>
                <p className="muted-text" style={{ fontSize: 14 }}>
                  We&apos;ll reach out by phone to confirm your details and answer any questions.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <Mail size={20} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ fontWeight: 700, marginBottom: 2 }}>Check your email</p>
                <p className="muted-text" style={{ fontSize: 14 }}>
                  You&apos;ll get a confirmation email with everything you need to keep moving.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <MessageSquare size={20} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ fontWeight: 700, marginBottom: 2 }}>Watch for a text</p>
                <p className="muted-text" style={{ fontSize: 14 }}>
                  We&apos;ll also text you so you don&apos;t miss a thing.
                </p>
              </div>
            </div>
          </div>

          <p className="muted-text" style={{ fontSize: 13, marginTop: 20 }}>
            Keep your phone handy and add {PHONE_DISPLAY} to your contacts so our call, email, and
            text don&apos;t get missed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", padding: "40px 20px" }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
          <span className="muted-text">ALMOST DONE</span>
          <span style={{ color: "var(--teal)" }}>{progress}%</span>
        </div>
        <div style={{ height: 6, background: "var(--border)", borderRadius: 999, marginBottom: 20, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "var(--teal)", transition: "width 0.3s" }} />
        </div>

        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              color: "var(--teal)",
              background: "rgba(0,169,157,0.1)",
              borderRadius: 999,
              padding: "4px 12px",
            }}
          >
            ● TAKES ABOUT 2 MINUTES
          </span>
        </div>

        {/* Headline and subtext stay the SAME across every step, matching
            the benchmark -- one stable frame the person sees throughout,
            only the question underneath changes. Not step-conditional. */}
        <h1 style={{ fontSize: 26, marginBottom: 8, textAlign: "center" }}>
          You&apos;re one step from <em style={{ color: "var(--teal)", fontStyle: "italic" }}>the keys</em>.
        </h1>
        <p className="muted-text" style={{ textAlign: "center", marginBottom: 28 }}>
          Answer a few quick questions and we&apos;ll get you moving fast — no credit check,
          unlimited mileage, and insurance already included.
        </p>

        <div className="card">
          {step === "license" && (
            <>
              <p style={{ fontWeight: 700, marginBottom: 16 }}>Do you currently hold a valid driver&apos;s license? *</p>
              {[
                { label: "Yes", value: true },
                { label: "No", value: false },
              ].map((opt) => (
                <label key={String(opt.value)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", cursor: "pointer" }}>
                  <input type="radio" name="license" checked={hasLicense === opt.value} onChange={() => setHasLicense(opt.value)} />
                  {opt.label}
                </label>
              ))}
            </>
          )}

          {step === "driving" && (
            <>
              <p style={{ fontWeight: 700, marginBottom: 16 }}>
                Are you currently driving or planning to drive for apps like Uber, DoorDash, or Amazon
                Flex? *
              </p>
              {(
                [
                  { label: "Yes, I'm already driving", value: "already_driving" },
                  { label: "Not yet, but I'm ready to start", value: "ready_to_start" },
                  { label: "No", value: "no" },
                ] as { label: string; value: DrivingStatus }[]
              ).map((opt) => (
                <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", cursor: "pointer" }}>
                  <input type="radio" name="driving" checked={drivingStatus === opt.value} onChange={() => setDrivingStatus(opt.value)} />
                  {opt.label}
                </label>
              ))}
            </>
          )}

          {step === "urgency" && (
            <>
              <p style={{ fontWeight: 700, marginBottom: 16 }}>How soon do you want to start driving and earning? *</p>
              {(
                [
                  { label: "Today", value: "today" },
                  { label: "This Week", value: "this_week" },
                  { label: "Within 2 weeks", value: "within_2_weeks" },
                  { label: "Just checking my options", value: "just_checking" },
                ] as { label: string; value: Urgency }[]
              ).map((opt) => (
                <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", cursor: "pointer" }}>
                  <input type="radio" name="urgency" checked={urgency === opt.value} onChange={() => setUrgency(opt.value)} />
                  {opt.label}
                </label>
              ))}
            </>
          )}

          {step === "contact" && (
            <>
              <div className="field">
                <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Full Name *</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Enter your full name" />
              </div>
              <div className="field">
                <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Email *</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" />
              </div>
              <div className="field">
                <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Phone *</label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" />
              </div>
            </>
          )}

          {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            {stepIndex > 0 && (
              <button onClick={goBack} className="button-secondary" style={{ color: "var(--text)", borderColor: "var(--border)" }}>
                ← Go Back
              </button>
            )}
            {step === "contact" ? (
              <button onClick={handleSubmit} disabled={loading} className="button-primary" style={{ flex: 1 }}>
                {loading ? "Submitting..." : "Submit"}
              </button>
            ) : (
              <button onClick={goNext} disabled={!canAdvance()} className="button-primary" style={{ flex: 1 }}>
                Next →
              </button>
            )}
          </div>
        </div>

        {step === "contact" && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 24 }}>
              {["No credit check", "Unlimited miles", "Insurance included"].map((badge) => (
                <span
                  key={badge}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    padding: "6px 12px",
                  }}
                >
                  ✓ {badge}
                </span>
              ))}
            </div>
            <p className="muted-text" style={{ fontSize: 12, textAlign: "center", marginTop: 16 }}>
              Your information is private and secure. By submitting you agree to be contacted by Zivo
              about your rental.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
