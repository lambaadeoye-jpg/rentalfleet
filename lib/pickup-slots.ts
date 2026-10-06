// Pure helpers for the pickup slot picker (Phase 3A). The database decides
// which slots exist and are free (migration 0073); this file only formats
// them, maps database error codes to plain language, and validates the weekly
// hours staff enter. No I/O, so it is unit-tested.

export type Slot = { startsAt: string; endsAt: string; spotsLeft: number };

export type DaySlots = {
  dayKey: string; // YYYY-MM-DD in the location's time zone
  label: string; // e.g. "Thu, Oct 8"
  slots: { startsAt: string; label: string }[]; // label e.g. "10:00 AM"
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const SLOT_MINUTE_OPTIONS = [15, 20, 30, 45, 60] as const;
export const DEFAULT_TIMEZONE = "America/Chicago";

function safeTz(tz: string | null | undefined): string {
  const candidate = tz && tz.trim() ? tz : DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Group slots by calendar day in the location's own time zone. Input order is kept. */
export function groupSlotsByDay(slots: Slot[], tz: string | null | undefined): DaySlots[] {
  const zone = safeTz(tz);
  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const dayLabelFmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric" });
  const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });

  const out: DaySlots[] = [];
  const byKey = new Map<string, DaySlots>();
  for (const s of slots) {
    const d = new Date(s.startsAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = dayKeyFmt.format(d);
    let day = byKey.get(key);
    if (!day) {
      day = { dayKey: key, label: dayLabelFmt.format(d), slots: [] };
      byKey.set(key, day);
      out.push(day);
    }
    day.slots.push({ startsAt: s.startsAt, label: timeFmt.format(d) });
  }
  return out;
}

/** Friendly time such as "Thu, Oct 8 at 10:00 AM" in the location's zone. */
export function formatSlotTime(iso: string, tz: string | null | undefined): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const zone = safeTz(tz);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(d);
  return `${day} at ${time}`;
}

const ERROR_MESSAGES: Record<string, string> = {
  feature_disabled: "Online pickup booking isn't available right now. We'll contact you to set a time.",
  rental_not_found: "We couldn't find your rental. Please sign in again.",
  rental_not_schedulable: "Your rental isn't ready for a pickup time yet. We'll let you know when it is.",
  location_not_found: "That pickup location isn't available.",
  slot_unavailable: "Sorry, that time was just taken. Please pick another.",
  needs_staff: "Your pickup time needs a quick change from our team. We'll be in touch.",
};

const KNOWN_CODES = Object.keys(ERROR_MESSAGES);

/** The database raises plain codes ("slot_unavailable"); find one inside any error text. */
export function extractSlotErrorCode(message: string | null | undefined): string | null {
  if (!message) return null;
  for (const code of KNOWN_CODES) {
    if (message.includes(code)) return code;
  }
  return null;
}

export function slotErrorMessage(message: string | null | undefined): string {
  const code = extractSlotErrorCode(message);
  return code ? ERROR_MESSAGES[code] : "Something went wrong. Please try again.";
}

/** Outcome words returned by confirm_pickup_slot -> a message (null = success). */
export function confirmOutcomeMessage(outcome: string): string | null {
  switch (outcome) {
    case "confirmed":
    case "already_confirmed":
      return null;
    case "expired":
      return "Your hold on that time ran out. Please pick a time again.";
    case "payment_required":
      return "Payment is needed to lock in this time.";
    default:
      return "That time can't be confirmed anymore. Please pick another.";
  }
}

// ---- Staff: weekly hours ----------------------------------------------------

export type WeeklyRuleInput = {
  weekday: number; // 0 = Sunday
  open: boolean;
  startTime: string; // "HH:MM" 24h
  endTime: string;
  slotMinutes: number;
  capacity: number;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function minutesOfDay(t: string): number | null {
  if (!TIME_RE.test(t)) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Returns an error string for the first problem, or null when valid. Closed days are not checked. */
export function validateWeeklyRules(rules: WeeklyRuleInput[]): string | null {
  const seen = new Set<number>();
  for (const r of rules) {
    if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) return "Invalid day.";
    if (seen.has(r.weekday)) return "Each day can only be listed once.";
    seen.add(r.weekday);
    if (!r.open) continue;
    const name = WEEKDAYS[r.weekday];
    const start = minutesOfDay(r.startTime);
    const end = minutesOfDay(r.endTime);
    if (start === null || end === null) return `${name}: enter opening and closing times.`;
    if (end <= start) return `${name}: closing time must be after opening time.`;
    if (!(SLOT_MINUTE_OPTIONS as readonly number[]).includes(r.slotMinutes)) return `${name}: choose a slot length.`;
    if (end - start < r.slotMinutes) return `${name}: hours are shorter than one slot.`;
    if (!Number.isInteger(r.capacity) || r.capacity < 1 || r.capacity > 20) return `${name}: pickups per slot must be 1 to 20.`;
  }
  return null;
}

/** Whole minutes (5-240) the hold lasts; mirrors the database clamp. */
export function clampHoldMinutes(v: number): number {
  if (!Number.isFinite(v)) return 30;
  return Math.min(240, Math.max(5, Math.round(v)));
}
