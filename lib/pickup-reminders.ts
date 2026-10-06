// Pickup reminder texts and missed-pickup message. Pure functions only, so the
// wording and send rules are unit-tested. The database (migration 0077) decides
// WHICH reminders are due; this decides what they say and whether to send now.

import { isWithinSendWindow } from "./outreach-rules";
import { toE164 } from "./contact-validation";

export type ReminderKind = "24h" | "4h" | "2h" | "missed";

export const REMINDER_TEMPLATES: Record<ReminderKind, string> = {
  "24h": "Zivo: Reminder, your car pickup is {when} at {place}. Bring your driver license and the card you paid with. Reply YES to confirm or CHANGE to reschedule. Reply STOP to opt out.",
  "4h": "Zivo: Your pickup is {when} at {place}. Reply YES to confirm or CHANGE to reschedule. Reply STOP to opt out.",
  "2h": "Zivo: See you {when} at {place}. Bring your driver license and the card you paid with. Reply CHANGE if you can't make it. Reply STOP to opt out.",
  missed: "Zivo: We missed you at your pickup time. Our team will reach out shortly about next steps. Reply STOP to opt out.",
};

export const YES_REPLY = "Zivo: Thanks, you're confirmed for {when} at {place}. See you then! Reply STOP to opt out.";
export const CHANGE_REPLY = "Zivo: No problem. Pick a new time here: {link} Our team has been notified. Reply STOP to opt out.";

type Parts = { y: number; m: number; d: number; hour: number; minute: number; weekday: string; month: string };

function parts(at: Date, tz: string): Parts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", weekday: "long", hour12: false,
  }).formatToParts(at);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour"));
  return {
    y: Number(get("year")), m: new Date(`${get("month")} 1, 2000`).getMonth() + 1, d: Number(get("day")),
    hour: hour === 24 ? 0 : hour, minute: Number(get("minute")), weekday: get("weekday"), month: get("month"),
  };
}

function clock(p: Parts): string {
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, "0")} ${p.hour < 12 ? "AM" : "PM"}`;
}

const dayNumber = (p: Parts) => Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000);

/** "today at 2:30 PM", "tomorrow at 2:30 PM", or "Friday, Oct 9 at 2:30 PM" in the pickup location's time zone. */
export function formatPickupWhen(pickupAt: Date | string, tz: string, now: Date): string {
  const at = typeof pickupAt === "string" ? new Date(pickupAt) : pickupAt;
  let pp: Parts, np: Parts;
  try { pp = parts(at, tz); np = parts(now, tz); } catch { tz = "America/Chicago"; pp = parts(at, tz); np = parts(now, tz); }
  const diff = dayNumber(pp) - dayNumber(np);
  const time = clock(pp);
  if (diff === 0) return `today at ${time}`;
  if (diff === 1) return `tomorrow at ${time}`;
  return `${pp.weekday}, ${pp.month} ${pp.d} at ${time}`;
}

export type DueMessage = {
  kind: ReminderKind;
  pickup_at: string;
  first_name: string | null;
  phone: string | null;
  location_name: string | null;
  location_tz: string;
  suppressed: boolean;
};

export type SendDecision =
  | { action: "send"; to: string; body: string }
  | { action: "skip"; reason: string }
  | { action: "defer"; reason: string };

function fill(t: string, vars: Record<string, string>): string {
  return t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

/**
 * "defer" means: do not send now, put it back so the next run tries again
 * (quiet hours, or no text provider yet). The database only offers a reminder
 * inside its own time window, so a deferral can never turn into a late text.
 */
export function decideReminder(row: DueMessage, now: Date, smsConfigured: boolean, link: string): SendDecision {
  if (row.suppressed) return { action: "skip", reason: "suppressed" };
  const to = row.phone ? toE164(row.phone) : null;
  if (!to) return { action: "skip", reason: "no_phone" };
  if (!smsConfigured) return { action: "defer", reason: "sms_provider_not_configured" };
  if (!isWithinSendWindow(row.phone as string, now)) return { action: "defer", reason: "quiet_hours" };
  const body = fill(REMINDER_TEMPLATES[row.kind], {
    when: formatPickupWhen(row.pickup_at, row.location_tz, now),
    place: (row.location_name ?? "").trim() || "our pickup location",
    link,
  });
  return { action: "send", to, body };
}
