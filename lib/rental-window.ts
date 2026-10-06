// Pure, DB-free validation for a rental's pickup -> drop-off window.
// Staff choose the drop-off date; this enforces the one locked rule that
// applies to it (7-day minimum, on every plan) and counts billable days
// for the daily plan. Whole days, rounded up: a rental that runs even a
// few hours into an extra day counts that day.

export const MIN_RENTAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RentalWindowResult =
  | { ok: true; days: number }
  | { ok: false; error: string };

export function validateRentalWindow(pickupAt: Date, dropoffAt: Date): RentalWindowResult {
  if (Number.isNaN(pickupAt.getTime()) || Number.isNaN(dropoffAt.getTime())) {
    return { ok: false, error: "Enter a valid pickup and drop-off date and time." };
  }
  const diffMs = dropoffAt.getTime() - pickupAt.getTime();
  if (diffMs < MIN_RENTAL_DAYS * DAY_MS) {
    return { ok: false, error: `Drop-off must be at least ${MIN_RENTAL_DAYS} days after pickup — this is a locked minimum.` };
  }
  return { ok: true, days: Math.ceil(diffMs / DAY_MS) };
}

// Every rental's drop-off defaults to pickup + 7 days; staff may change it
// at any time (still subject to the 7-day minimum above).
export function defaultDropoff(pickupAt: Date): Date {
  return new Date(pickupAt.getTime() + MIN_RENTAL_DAYS * DAY_MS);
}

// A saved drop-off counts as "automatic" (not a staff override) when it is
// the default for that pickup, give or take a minute of form rounding.
export function isDefaultDropoff(pickupAt: Date, dropoffAt: Date): boolean {
  return Math.abs(dropoffAt.getTime() - defaultDropoff(pickupAt).getTime()) < 60 * 1000;
}
