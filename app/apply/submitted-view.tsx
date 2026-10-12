"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Clock, CreditCard, IdCard, Info, Mail, Phone, ChevronDown } from "lucide-react";
import { nextStepsFor } from "@/lib/application-next-steps";
import { PHONE_DISPLAY, PHONE_TEL, PHONE_IS_LIVE, SUPPORT_EMAIL } from "@/lib/site-config";
import { linkEmailForResume } from "./actions";

export type SummaryItem = { label: string; value: string };

const STATE_LABEL = { done: "Completed", current: "Current step", upcoming: "Coming up" } as const;
const TIP_ICONS = [Phone, CreditCard, IdCard];

// Shown after an application is submitted. It reflects the real status (in review, approved, declined,
// expired) and sets honest expectations: no timing promises, no named channel, no amounts.
export default function SubmittedView({
  firstName,
  status,
  summary,
  hasEmail,
  initialEmail,
}: {
  firstName: string;
  status: string;
  summary: SummaryItem[];
  hasEmail: boolean;
  initialEmail: string;
}) {
  const model = nextStepsFor(status, firstName);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the heading so screen-reader users hear the result and sighted users land at the top.
  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, []);

  const [email, setEmail] = useState(initialEmail);
  const [emailState, setEmailState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [emailError, setEmailError] = useState<string | null>(null);

  async function saveEmail() {
    if (emailState === "sending") return;
    setEmailState("sending");
    setEmailError(null);
    try {
      const result = await linkEmailForResume(email);
      if (!result.success) {
        setEmailState("error");
        setEmailError(result.error ?? "Couldn’t save that. Please try again.");
        return;
      }
      setEmailState("sent");
    } catch {
      setEmailState("error");
      setEmailError("That didn’t go through. Check your connection and try again.");
    }
  }

  const HeroIcon = model.view === "declined" ? Info : model.view === "expired" ? Clock : Check;
  const showEmailCard = (model.view === "in_review" || model.view === "approved") && !hasEmail;
  const decided = model.view === "declined" || model.view === "expired";

  return (
    <section className="sub" aria-labelledby="sub-heading">
      <div className="sub-hero">
        <div className={`sub-badge${decided ? " sub-badge--muted" : ""}`} aria-hidden="true">
          <span className="sub-badge__core">
            <HeroIcon size={26} strokeWidth={2.5} />
          </span>
        </div>
        <h1 id="sub-heading" ref={headingRef} tabIndex={-1} className="sub-title">
          {model.headline}
        </h1>
        <p className="sub-lede">{model.subline}</p>
      </div>

      {model.timeline.length > 0 && (
        <div className="card sub-card">
          <h2 className="sub-h2">What happens next</h2>
          <ol className="sub-timeline">
            {model.timeline.map((s) => (
              <li
                key={s.key}
                className="sub-step"
                data-state={s.state}
                aria-current={s.state === "current" ? "step" : undefined}
              >
                <span className="sub-node" aria-hidden="true">
                  {s.state === "done" ? <Check size={16} strokeWidth={3} /> : <span className="sub-node__dot" />}
                </span>
                <div className="sub-step__body">
                  <p className="sub-step__label">
                    <span className="sr-only">{STATE_LABEL[s.state]}: </span>
                    {s.label}
                    {s.state === "current" && <span className="sub-pill">You are here</span>}
                  </p>
                  <p className="sub-step__detail">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {model.tips.length > 0 && (
        <div className="card sub-card">
          <h2 className="sub-h2">To keep things moving</h2>
          <ul className="sub-tips">
            {model.tips.map((t, i) => {
              const Icon = TIP_ICONS[i] ?? Info;
              return (
                <li key={t}>
                  <span className="sub-tip__icon" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <span>{t}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showEmailCard && (
        <div className="card sub-card sub-email">
          <h2 className="sub-h2">
            <Mail size={16} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 8, color: "var(--teal-dark)" }} />
            Don&rsquo;t lose your place
          </h2>
          {emailState === "sent" ? (
            <p className="sub-note" role="status">
              Check your email to confirm. Once you do, you can come back from any device.
            </p>
          ) : (
            <>
              <p className="sub-note">
                Your application is saved on this device. Add an email to come back to it from your phone, a
                computer, or anywhere else.
              </p>
              <form
                className="sub-email__row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveEmail();
                }}
              >
                <label htmlFor="sub-email" className="sr-only">
                  Email address
                </label>
                <input
                  id="sub-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={emailState === "error" ? true : undefined}
                  aria-describedby={emailError ? "sub-email-error" : undefined}
                />
                <button type="submit" className="button-primary" disabled={emailState === "sending" || !email.trim()}>
                  {emailState === "sending" ? "Saving…" : "Save email"}
                </button>
              </form>
              {emailError && (
                <p id="sub-email-error" className="error-text" role="alert" style={{ marginTop: 8, fontSize: 13 }}>
                  {emailError}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {summary.length > 0 && !decided && (
        <details className="card sub-card sub-summary">
          <summary>
            <span>What you submitted</span>
            <ChevronDown size={18} aria-hidden="true" className="sub-summary__chev" />
          </summary>
          <dl>
            {summary.map((s) => (
              <div key={s.label} className="sub-summary__row">
                <dt>{s.label}</dt>
                <dd>{s.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      <div className="sub-help">
        <p className="sub-help__title">{decided ? "Need to talk to us?" : "Questions or need to change something?"}</p>
        {PHONE_IS_LIVE ? (
          <a href={`tel:${PHONE_TEL}`} className="button-secondary sub-help__btn">
            <Phone size={16} aria-hidden="true" /> Call {PHONE_DISPLAY}
          </a>
        ) : (
          <a href={`mailto:${SUPPORT_EMAIL}`} className="button-secondary sub-help__btn">
            <Mail size={16} aria-hidden="true" /> Email {SUPPORT_EMAIL}
          </a>
        )}
      </div>
    </section>
  );
}
