"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { submitLeadStep1, completeLeadStep2 } from "./actions";
import { HEARD_ABOUT_OPTIONS } from "@/lib/lead-steps";
import { readFirstTouch } from "@/lib/attribution";
import { CONTACT_CONSENT_TEXT } from "@/lib/contact-consent";

type VehicleCategory = { id: string; name: string; description: string | null };
type GigPlatform = { id: string; code: string; name: string };

export default function LeadForm({
  categories,
  platforms,
}: {
  categories: VehicleCategory[];
  platforms: GigPlatform[];
}) {
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  // Step 1 saves the lead right away; step 2 finishes it using this one-time token.
  const [step, setStep] = useState<1 | 2>(1);
  const [saved, setSaved] = useState<{ leadId: string; token: string; firstName: string } | null>(null);
  const [step2Note, setStep2Note] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [consent, setConsent] = useState(false); // unchecked by default, never required
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const searchParams = useSearchParams();
  const referralCode = searchParams.get("ref") ?? undefined;
  // Real bug found in testing: the success card is much shorter than the
  // full form it replaces. The page's total height collapses, but the
  // browser keeps its scroll position in pixels, not tied to content --
  // so the viewport ends up pointed at whatever now sits at that old
  // offset (a lower section), never showing the success message at all.
  // A lead who submits and sees an unrelated section has no idea their
  // submission worked -- a real, silent way to lose leads who think it
  // failed and leave (or worse, resubmit).
  const successRef = useRef<HTMLDivElement>(null);

  const otherPlatform = platforms.find((p) => p.code === "other");
  const otherSelected = otherPlatform ? selectedPlatforms.includes(otherPlatform.id) : false;

  function togglePlatform(id: string) {
    setSelectedPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function handleStep1(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const emailValue = String(form.get("email") || "");
    const firstName = String(form.get("firstName") || "");

    try {
      const result = await submitLeadStep1({
        firstName,
        phone: String(form.get("phone") || ""),
        email: emailValue,
        otherPlatformDetail: String(form.get("otherPlatformDetail") || ""),
        pickupDate: (form.get("pickupDate") as string) || null,
        gigPlatformIds: selectedPlatforms,
        referralCode,
        contactConsent: consent,
        attribution: readFirstTouch(),
      });

      if (!result.success) {
        setError(result.error);
        return;
      }
      setSubmittedEmail(emailValue);
      setSaved({ leadId: result.leadId, token: result.token, firstName: firstName.trim() });
      setStep(2);
    } catch {
      // submitLeadStep1 never throws, but a second guard means the button can never stick on "Saving...".
      setError("Something went wrong. Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  async function handleStep2(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!saved) return;
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    try {
      const result = await completeLeadStep2({
        leadId: saved.leadId,
        token: saved.token,
        lastName: String(form.get("lastName") || ""),
        preferredCategoryId: (form.get("preferredCategoryId") as string) || null,
        rentalOption: (form.get("rentalOption") as string) || null,
        urgency: (form.get("urgency") as string) || null,
        additionalInfo: String(form.get("additionalInfo") || ""),
        heardAbout: (form.get("heardAbout") as string) || null,
      });
      if (!result.success) {
        if (!result.requestSaved) {
          setError(result.error);
          return;
        }
        // The lead is already saved from step 1; never make someone redo it because the details failed.
        setStep2Note(result.error);
      }
      setSubmitted(true);
    } catch {
      setStep2Note("We couldn't save those last details, but your request is saved and we'll follow up.");
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (submitted) {
      successRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [submitted]);

  if (submitted) {
    return (
      <div ref={successRef} className="card" style={{ textAlign: "center", padding: 48 }}>
        <CheckCircle2 size={40} color="var(--teal)" style={{ marginBottom: 12 }} />
        <h3 style={{ fontSize: 22, marginBottom: 8 }}>Thanks — we've got your request.</h3>
        <p className="muted-text" style={{ marginBottom: step2Note ? 8 : 20 }}>
          We'll review your information and follow up with the next step.
        </p>
        {step2Note && <p className="muted-text" style={{ marginBottom: 20, fontSize: 13 }}>{step2Note}</p>}
        {/* Bridge to the real Application Workspace -- previously there was
            no path forward for someone ready to go further immediately;
            they'd just see this message with nowhere else to go. */}
        <p style={{ fontSize: 14, marginBottom: 12 }}>Already know you're ready?</p>
        <a
          href={submittedEmail ? `/apply?email=${encodeURIComponent(submittedEmail)}` : "/apply"}
          className="button-primary"
          style={{ display: "inline-flex" }}
        >
          Continue to Full Application
        </a>
      </div>
    );
  }

  if (step === 2 && saved) {
    return (
      <form onSubmit={handleStep2} className="card">
        <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>Step 2 of 2</p>
        <h3 style={{ fontSize: 20, marginBottom: 4 }}>
          Thanks{saved.firstName ? `, ${saved.firstName}` : ""}. We&apos;ve got your request.
        </h3>
        <p className="muted-text" style={{ marginBottom: 20 }}>
          A few more details help us match you to the right car. Takes under a minute.
        </p>

        <div className="field">
          <label htmlFor="lastName">Last name *</label>
          <input id="lastName" name="lastName" required autoComplete="family-name" />
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="preferredCategoryId">Preferred vehicle category</label>
            <select id="preferredCategoryId" name="preferredCategoryId" defaultValue="">
              <option value="">No preference</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="urgency">How soon do you need a car?</label>
            <select id="urgency" name="urgency" defaultValue="">
              <option value="">Select one</option>
              <option value="today">Today</option>
              <option value="this_week">This week</option>
              <option value="within_2_weeks">Within 2 weeks</option>
              <option value="just_checking">Just checking options</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label>Rental option</label>
          <div style={{ display: "flex", gap: 20, marginTop: 6 }}>
            <label className="checkbox-item">
              <input type="radio" name="rentalOption" value="daily" />
              Daily
            </label>
            <label className="checkbox-item">
              <input type="radio" name="rentalOption" value="weekly" defaultChecked />
              Weekly
            </label>
          </div>
        </div>

        <div className="field">
          <label htmlFor="heardAbout">How did you hear about us? (optional)</label>
          <select id="heardAbout" name="heardAbout" defaultValue="">
            <option value="">Select one</option>
            {HEARD_ABOUT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="additionalInfo">Additional information (optional)</label>
          <textarea id="additionalInfo" name="additionalInfo" rows={3} />
        </div>

        {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

        <button type="submit" className="button-primary" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Saving..." : "Finish"}
        </button>
        <button
          type="button"
          onClick={() => setSubmitted(true)}
          disabled={loading}
          className="muted-text"
          style={{ display: "block", margin: "12px auto 0", background: "none", border: 0, cursor: "pointer", fontSize: 13, textDecoration: "underline" }}
        >
          I&apos;ll finish later
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleStep1} className="card">
      <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>Step 1 of 2</p>
      <h3 style={{ fontSize: 20, marginBottom: 4 }}>Let&apos;s find the right vehicle for your work.</h3>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Takes about a minute. No document uploads here — just the basics.
      </p>

      <div className="form-row">
        <div className="field">
          <label htmlFor="firstName">First name *</label>
          <input id="firstName" name="firstName" required autoComplete="given-name" />
        </div>
        <div className="field">
          <label htmlFor="phone">Mobile phone number *</label>
          <input id="phone" name="phone" type="tel" required autoComplete="tel" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="email">Email *</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
      </div>

      <div className="field">
        <label>What are you driving for? (select all that apply)</label>
        <div className="checkbox-grid">
          {platforms.map((p) => (
            <label key={p.id} className="checkbox-item">
              <input
                type="checkbox"
                checked={selectedPlatforms.includes(p.id)}
                onChange={() => togglePlatform(p.id)}
              />
              {p.name}
            </label>
          ))}
        </div>
        {otherSelected && (
          <input
            name="otherPlatformDetail"
            placeholder="Tell us what you're driving for"
            style={{ marginTop: 10 }}
          />
        )}
      </div>

      <div className="field">
        <label htmlFor="pickupDate">Desired start date</label>
        <input id="pickupDate" name="pickupDate" type="date" />
      </div>

      <label className="checkbox-item" style={{ alignItems: "flex-start", marginBottom: 14, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>{CONTACT_CONSENT_TEXT}</span>
      </label>

      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

      <button type="submit" className="button-primary" disabled={loading} style={{ width: "100%" }}>
        {loading ? "Saving..." : "Continue"}
      </button>
      <p className="muted-text" style={{ textAlign: "center", marginTop: 10, fontSize: 13 }}>
        No spam. No obligation. We&apos;ll follow up shortly after you submit.
      </p>
    </form>
  );
}
