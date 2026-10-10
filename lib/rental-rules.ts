// The house rules a renter is walked through at pickup, the message they get afterwards, and the runner's quick answers.
// ONE source of numbers: the fees and limits come from the approved agreement (so what the runner says always matches what
// the renter signed), plus a few office settings that are not in the agreement. Pure functions, so every sentence is tested.

import { STARTER_VARIABLES } from "./agreement";
import { portalBase } from "./portal-links";

export type RuleValues = {
  travelArea: string;
  lateRentFee: string;
  lateRentCutoff: string;
  lateReturnFee: string;
  tollFee: string;
  adminFee: string;
  deductible: string;
  mileage: string;
  minDriverAge: string;
  ticketPayHours: number;
  ticketReviewThreshold: number;
  maintenanceDays: number;
  insuranceLine: string;
  instagram: string;
  reviewUrl: string | null;
  guideUrl: string;
  portalUrl: string;
  supportPhone: string | null;
};

/** Office settings kept in tenant_setting (not part of the signed agreement). */
export const RULE_SETTING_KEYS = [
  "rules_ticket_pay_hours", "rules_ticket_review_threshold", "rules_maintenance_days", "rules_insurance_line", "rules_instagram", "google_review_url",
] as const;

export const DEFAULT_INSURANCE_LINE =
  "You must carry liability insurance. If you have none, ask your insurer whether a non-owner liability policy meets your needs and the legal requirements.";

function posInt(v: string | null | undefined, fallback: number, max = 1000): number {
  const n = Number(String(v ?? "").trim());
  return Number.isInteger(n) && n > 0 && n <= max ? n : fallback;
}

function money(v: string | undefined, fallback: string): string {
  const s = String(v ?? "").trim().replace(/^\$/, "");
  return s || fallback;
}

export function buildRuleValues(input: {
  agreementVars?: Record<string, string> | null;
  settings?: Record<string, string | null | undefined> | null;
  siteUrl?: string | null;
  supportPhone?: string | null;
}): RuleValues {
  const a = { ...STARTER_VARIABLES, ...(input.agreementVars ?? {}) } as Record<string, string>;
  const s = input.settings ?? {};
  const site = (input.siteUrl || "https://rentzivo.com").replace(/\/$/, "");
  const handle = String(s.rules_instagram ?? "").trim().replace(/^@?/, "@");
  const review = String(s.google_review_url ?? "").trim();
  return {
    travelArea: a.travel_area.trim(),
    lateRentFee: money(a.late_rent_fee, "50"),
    lateRentCutoff: a.late_rent_cutoff.trim(),
    lateReturnFee: money(a.late_return_fee, "250"),
    tollFee: money(a.toll_fee, "6"),
    adminFee: money(a.admin_fee, "25"),
    deductible: money(a.deductible, "1,000"),
    mileage: a.mileage_allowance.trim(),
    minDriverAge: a.min_driver_age.trim(),
    ticketPayHours: posInt(s.rules_ticket_pay_hours, 24, 168),
    ticketReviewThreshold: posInt(s.rules_ticket_review_threshold, 5, 100),
    maintenanceDays: posInt(s.rules_maintenance_days, 30, 365),
    insuranceLine: String(s.rules_insurance_line ?? "").trim() || DEFAULT_INSURANCE_LINE,
    instagram: handle.length > 1 ? handle : "@rentzivo",
    reviewUrl: /^https?:\/\//i.test(review) ? review : null,
    guideUrl: `${site}/guides/driver-signup`,
    portalUrl: `${portalBase(site)}/portal`,
    supportPhone: input.supportPhone?.trim() || null,
  };
}

export type BriefingRule = { id: string; title: string; text: string };

/** What the runner explains, one tap each. The text is also what the renter reads afterwards. */
export function briefingRules(v: RuleValues): BriefingRule[] {
  return [
    { id: "includes", title: "What is included", text: `Miles: ${v.mileage.toLowerCase() === "unlimited" ? "unlimited" : v.mileage}. We pay for oil changes and for warning-light and brake repairs you did not cause. Tires are not included.` },
    { id: "tolls", title: "Tolls", text: `$${v.tollFee} for each toll invoiced to us. That is the whole charge.` },
    { id: "tickets", title: "Tickets", text: `You pay every ticket plus a $${v.adminFee} admin fee each, within ${v.ticketPayHours} hours of us telling you.` },
    { id: "late", title: "Late rent", text: `Rent is charged to your saved card on the due date, and we text you the day before. If it is not paid by ${v.lateRentCutoff} that day, a $${v.lateRentFee} late fee applies.` },
    { id: "nonpayment", title: "Unpaid rent", text: `If rent is still unpaid 24 hours after it is due, we may ask for the car back. If it is not returned, a $${v.lateReturnFee} recovery fee applies and future rentals may be restricted.` },
    { id: "area", title: "Where you can drive", text: `Stay within ${v.travelArea} unless we approve it in writing first.` },
    { id: "drivers", title: "Who can drive", text: `Only drivers named on the agreement. Anyone else must send a license and get approved before driving.` },
    { id: "deductible", title: "Deductible", text: `$${v.deductible} for an at-fault accident or a breach of the agreement. It applies only if you do not have your own full coverage. The signed agreement has the exact terms.` },
    { id: "incidents", title: "If something happens", text: `Call the police when needed and get a report, then contact us as soon as you can. Do not repair the car yourself.` },
    { id: "maintenance", title: "Maintenance", text: `The car is serviced about every ${v.maintenanceDays} days. We will confirm the appointment with you. Tell us sooner if anything feels wrong.` },
    { id: "insurance", title: "Insurance", text: v.insuranceLine },
    { id: "smoking", title: "No smoking", text: `No smoking inside the car. It means you forfeit your deposit.` },
  ];
}

export type PostPickupMessage = { sms: string; emailSubject: string; emailText: string };

export function postPickupMessage(v: RuleValues, firstName: string | null): PostPickupMessage {
  const name = firstName?.trim() || "there";
  const rules = briefingRules(v);
  const get = (id: string) => rules.find((r) => r.id === id)!.text;
  const review = v.reviewUrl ? `\nPlease leave a review: ${v.reviewUrl}` : "";
  const help = v.supportPhone ? `\nQuestions? ${v.supportPhone}` : "";

  const emailText = [
    `Hey ${name},`,
    "",
    "Thanks again for renting with us. Here are the house rules we went over:",
    "",
    `Tickets and tolls: ${get("tolls")} ${get("tickets")}`,
    `Late rent: ${get("late")}`,
    `Distance: ${get("area")}`,
    `Drivers: ${get("drivers")}`,
    `Deductible: ${get("deductible")} We use the police report to help decide fault.`,
    `Maintenance: ${get("maintenance")}`,
    `Unpaid rent: ${get("nonpayment")}`,
    `Insurance: ${get("insurance")}`,
    `No smoking: ${get("smoking")}`,
    "",
    "These rules are a summary. Your signed agreement controls.",
    `You can read them any time in your portal: ${v.portalUrl}`,
    `Follow us on Instagram: ${v.instagram}`,
    review.trim(),
    "",
    `New to the apps? Our sign-up guide: ${v.guideUrl}`,
    help.trim(),
    "",
    "We hope you enjoy your rental!",
  ].filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const sms =
    `Zivo: Hi ${name}, thanks for renting! Quick rules: tickets paid within ${v.ticketPayHours}h (tolls are a flat $${v.tollFee}); rent paid by ${v.lateRentCutoff} on the due date or $${v.lateRentFee} late fee; stay in ${v.travelArea}; listed drivers only; no smoking. ` +
    `Full rules: ${v.portalUrl}` +
    (v.reviewUrl ? ` Review us: ${v.reviewUrl}` : "") +
    " Reply STOP to opt out.";

  return { sms, emailSubject: "Your Zivo rental: house rules", emailText };
}

export type QuickAnswer = { q: string; a: string };

/** The runner's cheat sheet. Internal notes included. */
export function quickAnswers(v: RuleValues): QuickAnswer[] {
  const r = (id: string) => briefingRules(v).find((x) => x.id === id)!.text;
  return [
    { q: "Tolls", a: r("tolls") },
    { q: "Tickets", a: `${r("tickets")} Office reviews a renter with more than ${v.ticketReviewThreshold} tickets.` },
    { q: "Late rent", a: r("late") },
    { q: "Unpaid rent", a: r("nonpayment") },
    { q: "Where can they drive?", a: r("area") },
    { q: "Extra drivers", a: r("drivers") },
    { q: "Deductible", a: r("deductible") },
    { q: "Accident or incident", a: r("incidents") },
    { q: "Maintenance", a: r("maintenance") },
    { q: "Insurance", a: r("insurance") },
    { q: "Smoking", a: r("smoking") },
    { q: "Anything else", a: "Say you will check with the office. Never promise a fee waiver or an exception." },
  ];
}
