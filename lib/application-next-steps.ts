// What an applicant sees after they submit: a plain "what happens next" timeline that matches the
// application's real status. Pure and DB-free so the wording rules are unit-tested.
//
// Wording rules (decided with the owner, see the V2.1 spec and V2.2 addendum section 7):
//  - No timing promises and no approval predictions.
//  - No named channel (text/email/call) until those workflows are live; say "the phone number and
//    email you gave us".
//  - Money is stated as fact only: rent and a refundable security deposit, no amount, no promotion.
//  - Cards: own card only, no cash.

export type SubmittedView = "in_review" | "approved" | "declined" | "expired";
export type StepState = "done" | "current" | "upcoming";

export type TimelineStep = { key: string; label: string; detail: string; state: StepState };

export type NextStepsModel = {
  view: SubmittedView;
  headline: string;
  subline: string;
  timeline: TimelineStep[];
  tips: string[];
};

/** Maps a raw application status to the screen we show. "draft" never reaches this screen. */
export function submittedViewFor(status: string): SubmittedView {
  if (status === "approved" || status === "conditionally_approved") return "approved";
  if (status === "declined") return "declined";
  if (status === "expired") return "expired";
  return "in_review"; // submitted, screening, review
}

const TIPS = [
  "Keep your phone nearby. We’ll use the phone number and email you gave us.",
  "Pay with a card in your own name. We don’t accept cash.",
  "Have your driver’s license with you at pickup.",
];

export function nextStepsFor(status: string, firstName: string): NextStepsModel {
  const view = submittedViewFor(status);
  const name = firstName.trim();
  const thanks = name ? `Thanks, ${name}.` : "Thanks.";

  if (view === "approved") {
    return {
      view,
      headline: "You’re approved",
      subline: `${thanks} Your application has been approved. Here’s what comes next.`,
      timeline: [
        { key: "submitted", label: "Application submitted", detail: "We have everything you sent.", state: "done" },
        { key: "review", label: "Application reviewed", detail: "Your application has been approved.", state: "done" },
        {
          key: "next",
          label: "Sign, pay and choose a pickup",
          detail: "You’ll review and sign your rental agreement, pay your rent and a refundable security deposit, and choose a pickup time. We’ll contact you with the details.",
          state: "current",
        },
        { key: "pickup", label: "Pick up your car", detail: "Pickup is available in Nashville and Murfreesboro.", state: "upcoming" },
      ],
      tips: TIPS,
    };
  }

  if (view === "declined") {
    return {
      view,
      headline: "We couldn’t approve this application",
      subline: "If you think this is a mistake, contact us and we’ll take another look.",
      timeline: [],
      tips: [],
    };
  }

  if (view === "expired") {
    return {
      view,
      headline: "This application has expired",
      subline: "Contact us and we’ll help you start a new one.",
      timeline: [],
      tips: [],
    };
  }

  return {
    view,
    headline: "Application submitted",
    subline: `${thanks} We’ve got your application. Here’s what happens next.`,
    timeline: [
      { key: "submitted", label: "Application submitted", detail: "We have everything you sent.", state: "done" },
      {
        key: "review",
        label: "We review your application",
        detail: "Our team looks over your details and documents.",
        state: "current",
      },
      {
        key: "contact",
        label: "We contact you with the next step",
        detail: "We’ll reach out using the phone number and email you gave us.",
        state: "upcoming",
      },
      {
        key: "approved",
        label: "If approved: sign, pay and pick up",
        detail: "You’ll sign your rental agreement, pay your rent and a refundable security deposit, and choose a pickup in Nashville or Murfreesboro.",
        state: "upcoming",
      },
    ],
    tips: TIPS,
  };
}

/** Shows only the last 4 of a license number so the on-screen summary never repeats the full value. */
export function maskLicense(value: string | null | undefined): string {
  const v = (value ?? "").replace(/\s+/g, "");
  if (!v) return "";
  if (v.length <= 4) return "••••";
  return `••••${v.slice(-4)}`;
}

/** Insurance line for the read-only summary. General wording only; never names a provider or a promise. */
export function insuranceSummary(hasOwn: boolean | null, provider: string): string {
  if (hasOwn === true) return provider.trim() || "Your own coverage";
  if (hasOwn === false) return "We’ll help you get coverage sorted";
  return "Not answered";
}
