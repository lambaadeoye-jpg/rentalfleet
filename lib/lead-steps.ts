// Validation for the two-step lead form. Pure functions so the rules are unit-tested; the database
// (migration 0084) is still the real enforcement.

import { isValidEmail, isValidUsPhone } from "./contact-validation";

export const HEARD_ABOUT_OPTIONS = [
  { value: "facebook", label: "Facebook or Instagram" },
  { value: "google", label: "Google search or maps" },
  { value: "friend", label: "A friend or another driver" },
  { value: "driver_group", label: "A driver group or forum" },
  { value: "flyer", label: "A flyer or sign" },
  { value: "other", label: "Somewhere else" },
] as const;

const HEARD = new Set<string>(HEARD_ABOUT_OPTIONS.map((o) => o.value));
const URGENCY = new Set(["today", "this_week", "within_2_weeks", "just_checking"]);

export type Step1Input = { firstName: string; phone: string; email: string };

export function validateStep1(i: Step1Input): string | null {
  const first = (i.firstName ?? "").trim();
  if (!first || !(i.phone ?? "").trim() || !(i.email ?? "").trim()) {
    return "First name, mobile phone, and email are required.";
  }
  if (first.length > 80) return "That name looks too long. Please check it.";
  if (!isValidEmail(i.email.trim())) return "Please enter a valid email address.";
  if (!isValidUsPhone(i.phone.trim())) return "Please enter a valid 10-digit mobile number.";
  return null;
}

export type Step2Input = {
  lastName: string;
  rentalOption?: string | null;
  urgency?: string | null;
  heardAbout?: string | null;
  additionalInfo?: string | null;
};

export function validateStep2(i: Step2Input): string | null {
  const last = (i.lastName ?? "").trim();
  if (!last) return "Last name is required.";
  if (last.length > 80) return "That name looks too long. Please check it.";
  return null;
}

/** Values the database would ignore are dropped here so nothing odd is sent. */
export function cleanStep2(i: Step2Input) {
  return {
    lastName: (i.lastName ?? "").trim().slice(0, 80),
    rentalOption: i.rentalOption === "daily" || i.rentalOption === "weekly" ? i.rentalOption : null,
    urgency: i.urgency && URGENCY.has(i.urgency) ? i.urgency : null,
    heardAbout: i.heardAbout && HEARD.has(i.heardAbout) ? i.heardAbout : null,
    additionalInfo: (i.additionalInfo ?? "").trim().slice(0, 2000) || null,
  };
}
