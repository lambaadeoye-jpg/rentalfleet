"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Phone, Mail, MessageSquare } from "lucide-react";
import { submitLead } from "../actions";
import { CONTACT_CONSENT_TEXT } from "@/lib/contact-consent";
import LegalLinks from "../legal-links";
import { readFirstTouch, readLastCta } from "@/lib/attribution";
import { trackLead } from "@/lib/track";
import { PHONE_DISPLAY, PHONE_IS_LIVE } from "@/lib/site-config";

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
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false); // unchecked by default, never required
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
    const firstNameTrimmed = firstName.trim();
    const lastNameTrimmed = lastName.trim();
    const emailTrimmed = email.trim();
    const phoneTrimmed = phone.trim();

    if (!firstNameTrimmed || !lastNameTrimmed || !emailTrimmed || !phoneTrimmed) {
      setError("First name, last name, email, and phone are required.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const result = await submitLead({
        firstName: firstNameTrimmed,
        lastName: lastNameTrimmed,
        phone: phoneTrimmed,
        email: emailTrimmed,
        otherPlatformDetail: "",
        preferredCategoryId: null,
        pickupDate: null,
        rentalOption: "weekly",
        additionalInfo: "",
        gigPlatformIds: [],
        referralCode,
        contactConsent: consent,
        hasDriversLicense: hasLicense ?? undefined,
        drivingStatus: drivingStatus ?? undefined,
        urgency: urgency ?? undefined,
        attribution: { ...readFirstTouch(), cta: readLastCta() },
        sourceFallback: "get-started",
      });

      if (!result.success) {
        setError(result.error);
        return;
      }
      trackLead();
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
            Application received
          </p>
          <h1 style={{ fontSize: 30, marginBottom: 12 }}>Thanks — you&rsquo;re all set.</h1>
          <p className="muted-text" style={{ fontSize: 16, marginBottom: 32 }}>
            We&rsquo;ve got your info. <strong>We&rsquo;ll reach out soon</strong> to go
            over the next steps. Calls are usually during business hours.
          </p>

          <div className="card" style={{ textAlign: "left" }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "var(--teal)", marginBottom: 16 }}>
              What happens next
            </p>
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <Phone size={20} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ fontWeight: 700, marginBottom: 2 }}>We&rsquo;ll be in touch</p>
                <p className="muted-text" style={{ fontSize: 14 }}>
                  We&rsquo;ll contact you by phone or text to confirm your details and answer any questions.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <Mail size={20} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ fontWeight: 700, marginBottom: 2 }}>Watch your email</p>
                <p className="muted-text" style={{ fontSize: 14 }}>
                  We may email you a link to continue. Check spam if you don&rsquo;t see it.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <MessageSquare size={20} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ fontWeight: 700, marginBottom: 2 }}>Watch for a text</p>
                <p className="muted-text" style={{ fontSize: 14 }}>
                  We may text you from our number. Reply STOP any time to opt out.
                </p>
              </div>
            </div>
          </div>

          {PHONE_IS_LIVE && (
            <p className="muted-text" style={{ fontSize: 13, marginTop: 20 }}>
              Keep your phone handy and add {PHONE_DISPLAY} to your contacts so our call and text
              don&rsquo;t get missed.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", padding: "40px 20px" }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
          {/* "ALMOST DONE" on every step (matching the benchmark
              literally) would mean saying it on question one of four --
              manufactured momentum, not honest framing. A real step
              counter is accurate at every step instead of just
              borrowing a competitor’s psychological device because it
              converts well for them. */}
          <span className="muted-text">STEP {stepIndex + 1} OF {STEPS.length}</span>
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
            the benchmark — one stable frame the person sees throughout,
            only the question underneath changes. Not step-conditional. */}
        <h1 style={{ fontSize: 26, marginBottom: 8, textAlign: "center" }}>
          You&rsquo;re one step from <em style={{ color: "var(--teal)", fontStyle: "italic" }}>the keys</em>.
        </h1>
        <p className="muted-text" style={{ textAlign: "center", marginBottom: 28 }}>
          Answer a few quick questions and we&rsquo;ll get you moving fast — no credit check,
          unlimited mileage, and insurance already included.
        </p>

        <div className="card">
          {step === "license" && (
            <>
              <p style={{ fontWeight: 700, marginBottom: 16 }}>Do you currently hold a valid driver&rsquo;s license? *</p>
              {[
                { label: "Yes", value: true },
                { label: "No", value: false },
              ].map((opt) => (
                <label key={String(opt.value)} className="radio-option" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", cursor: "pointer" }}>
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
                  { label: "Yes, I’m already driving", value: "already_driving" },
                  { label: "Not yet, but I’m ready to start", value: "ready_to_start" },
                  { label: "No", value: "no" },
                ] as { label: string; value: DrivingStatus }[]
              ).map((opt) => (
                <label key={opt.value} className="radio-option" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", cursor: "pointer" }}>
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
                  { label: "This week", value: "this_week" },
                  { label: "Within 2 weeks", value: "within_2_weeks" },
                  { label: "Just checking my options", value: "just_checking" },
                ] as { label: string; value: Urgency }[]
              ).map((opt) => (
                <label key={opt.value} className="radio-option" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", cursor: "pointer" }}>
                  <input type="radio" name="urgency" checked={urgency === opt.value} onChange={() => setUrgency(opt.value)} />
                  {opt.label}
                </label>
              ))}
            </>
          )}

          {step === "contact" && (
            <>
              <div className="form-row">
                <div className="field">
                  <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>First name *</label>
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" />
                </div>
                <div className="field">
                  <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Last name *</label>
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" />
                </div>
              </div>
              <div className="field">
                <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Email *</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" />
              </div>
              <div className="field">
                <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Phone *</label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" />
              </div>
              <label className="checkbox-item" style={{ alignItems: "flex-start", fontSize: 13 }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
                <span>{CONTACT_CONSENT_TEXT}</span>
              </label>
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
              {["No credit check", "Unlimited miles", "Insurance if you need it"].map((badge) => (
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
            <LegalLinks style={{ textAlign: "center", marginTop: 16, fontSize: 12 }} />
          </>
        )}
      </div>
    </div>
  );
}
