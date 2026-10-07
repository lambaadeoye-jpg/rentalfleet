// Rules for automated lead outreach (texts, AI calls, emails). Pure functions
// only -- no I/O -- so every compliance rule is unit-tested. The dispatcher
// (app/api/automation/outreach/run) applies these before anything is sent.
//
// DRAFT cadence and wording: counsel must approve (see the consent doc).

export type Channel = "sms" | "call" | "email";

export type OutreachStep = {
  key: string;
  channel: Channel;
  /** Minutes after the lead was created. */
  delayMinutes: number;
  /** SMS and calls need the lead's recorded consent; email does not. */
  needsConsent: boolean;
};

// 8 touches over 14 days (journey recommendation). Email goes to everyone;
// texts and AI calls only to leads who ticked the consent box.
export const OUTREACH_PLAN: OutreachStep[] = [
  { key: "email_welcome", channel: "email", delayMinutes: 0, needsConsent: false },
  { key: "sms_welcome", channel: "sms", delayMinutes: 0, needsConsent: true },
  { key: "ai_call", channel: "call", delayMinutes: 3, needsConsent: true },
  { key: "sms_nudge", channel: "sms", delayMinutes: 24 * 60, needsConsent: true },
  { key: "email_nudge", channel: "email", delayMinutes: 2 * 24 * 60, needsConsent: false },
  { key: "sms_checkin", channel: "sms", delayMinutes: 4 * 24 * 60, needsConsent: true },
  { key: "email_help", channel: "email", delayMinutes: 7 * 24 * 60, needsConsent: false },
  { key: "sms_last", channel: "sms", delayMinutes: 14 * 24 * 60, needsConsent: true },
];

export const MAX_TOUCHES = 8;

/** Message wording. Never says anything about approval or decisions. */
export const SMS_TEMPLATES: Record<string, string> = {
  sms_welcome:
    "Zivo: Thanks {first}, we got your rental request. We'll text about next steps. Msg freq varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help.",
  sms_nudge:
    "Zivo: Hi {first}, ready to finish your rental request? It takes a few minutes: {link} Reply STOP to opt out.",
  sms_checkin:
    "Zivo: Hi {first}, still need a car? Reply YES and the team will reach out, or finish here: {link} Reply STOP to opt out.",
  sms_last:
    "Zivo: Last note from us, {first}. If you still want a rental, your request is saved: {link} Reply STOP to opt out.",
};

export const STOP_REPLY =
  "Zivo: You're unsubscribed and won't get more texts from us. Reply START to resubscribe.";
export const START_REPLY =
  "Zivo: You're subscribed again. Msg freq varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help.";
export const HELP_REPLY =
  "Zivo: For help call {support_phone} or email {support_email}. Reply STOP to opt out. Msg & data rates may apply.";

export function renderTemplate(t: string, vars: Record<string, string>): string {
  return t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

// ---- Inbound keyword handling -------------------------------------------

export type InboundKeyword = "stop" | "start" | "help" | "yes" | "change" | null;

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"]);
export const STOP_PHRASES =
  /\b(stop (texting|messaging|calling|contacting)|do not (text|call|contact)|don'?t (text|call|contact)|leave me alone|remove me|take me off|opt[ -]?out|no more (texts|messages|calls))\b/i;

/** When unsure, an opt-out wins: honoring a stop we didn't need is cheap. */
export function parseInboundKeyword(body: string): InboundKeyword {
  const raw = (body ?? "").trim();
  if (!raw) return null;
  const word = raw.toLowerCase().replace(/[^a-z ]/g, "").trim();
  if (STOP_WORDS.has(word.replace(/ /g, ""))) return "stop";
  if (STOP_PHRASES.test(raw)) return "stop";
  if (word === "start" || word === "unstop" || word === "subscribe") return "start";
  if (word === "help" || word === "info") return "help";
  if (word === "yes" || word === "y" || word === "yeah" || word === "yep") return "yes";
  if (word === "change") return "change";
  return null;
}

// ---- Quiet hours ----------------------------------------------------------

// Small map of US area codes we expect to see; Middle Tennessee is Central.
const AREA_CODE_TZ: Record<string, string> = {
  "615": "America/Chicago", "629": "America/Chicago", "931": "America/Chicago",
  "731": "America/Chicago", "901": "America/Chicago", "256": "America/Chicago",
  "205": "America/Chicago", "270": "America/Chicago", "502": "America/New_York",
  "423": "America/New_York", "865": "America/New_York", "404": "America/New_York",
  "770": "America/New_York", "678": "America/New_York", "212": "America/New_York",
  "305": "America/New_York", "786": "America/New_York", "813": "America/New_York",
  "312": "America/Chicago", "773": "America/Chicago", "214": "America/Chicago",
  "713": "America/Chicago", "512": "America/Chicago", "210": "America/Chicago",
  "602": "America/Phoenix", "480": "America/Phoenix",
  "303": "America/Denver", "720": "America/Denver",
  "213": "America/Los_Angeles", "310": "America/Los_Angeles", "415": "America/Los_Angeles",
  "619": "America/Los_Angeles", "206": "America/Los_Angeles",
};

export function areaCodeOf(phone: string): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d[0] === "1" ? d.slice(1) : d.length === 10 ? d : null;
  return ten ? ten.slice(0, 3) : null;
}

/** Legal window is 8am-9pm local. Known area code: 9am-8pm local (margin).
 * Unknown: a stricter 10am-7pm Central, which is inside 8am-9pm in every US
 * time zone from Pacific to Eastern. */
export function sendWindowFor(phone: string): { tz: string; startHour: number; endHour: number } {
  const ac = areaCodeOf(phone);
  const tz = ac ? AREA_CODE_TZ[ac] : undefined;
  if (tz) return { tz, startHour: 9, endHour: 20 };
  return { tz: "America/Chicago", startHour: 10, endHour: 19 };
}

function localHour(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return h === 24 ? 0 : h;
}

export function isWithinSendWindow(phone: string, at: Date): boolean {
  const w = sendWindowFor(phone);
  const h = localHour(w.tz, at);
  return h >= w.startHour && h < w.endHour;
}

/** Next moment (15-minute steps, up to 48h) that is inside the send window. */
export function nextSendTime(phone: string, from: Date): Date {
  const step = 15 * 60 * 1000;
  let t = new Date(Math.ceil(from.getTime() / step) * step);
  for (let i = 0; i < (48 * 60) / 15; i++) {
    if (isWithinSendWindow(phone, t)) return t;
    t = new Date(t.getTime() + step);
  }
  return t;
}

// ---- Send decision --------------------------------------------------------

export type LeadState = {
  hasConsent: boolean; // contact_consent_at is set
  suppressed: boolean; // STOP / opt-out recorded for this phone (texts, calls) or email
  redFlagged: boolean; // staff review first; no automation
  hasInboundReply: boolean; // person replied or asked for a human
  progressed: boolean; // application started, or lead moved past 'new'
  touchesSent: number;
  hasPhone: boolean;
  hasEmail: boolean;
};

export type SendDecision =
  | { action: "send" }
  | { action: "defer"; until: Date; reason: string }
  | { action: "skip"; reason: string };

export function decideSend(
  step: OutreachStep,
  lead: LeadState,
  phone: string,
  now: Date
): SendDecision {
  if (lead.suppressed) return { action: "skip", reason: "suppressed" };
  if (lead.redFlagged) return { action: "skip", reason: "red_flag_staff_review" };
  if (lead.progressed) return { action: "skip", reason: "lead_progressed" };
  if (lead.hasInboundReply && step.key !== "email_welcome" && step.key !== "sms_welcome") {
    return { action: "skip", reason: "person_replied" };
  }
  if (lead.touchesSent >= MAX_TOUCHES) return { action: "skip", reason: "touch_cap" };
  if (step.channel !== "email") {
    if (!lead.hasPhone) return { action: "skip", reason: "no_phone" };
    if (step.needsConsent && !lead.hasConsent) return { action: "skip", reason: "no_consent" };
    if (!isWithinSendWindow(phone, now)) {
      return { action: "defer", until: nextSendTime(phone, now), reason: "quiet_hours" };
    }
  } else if (!lead.hasEmail) {
    return { action: "skip", reason: "no_email" };
  }
  return { action: "send" };
}
