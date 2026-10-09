// Tolls and citations: matching each one to the rental that had the car, and
// pricing what the renter owes. Pure functions, no database.

export const TOLL_KINDS = ["toll", "citation"] as const;
export type TollKind = (typeof TOLL_KINDS)[number];

export const KIND_LABELS: Record<TollKind, string> = { toll: "Toll", citation: "Ticket or citation" };

// Agreement clause 3: $6 per toll invoiced, $25 per ticket or citation, on top of the toll or fine itself.
// These are the starter agreement's defaults; staff can change the fee on any single charge.
export const DEFAULT_FEES: Record<TollKind, number> = { toll: 6, citation: 25 };

// Maps onto the existing charge types so the Charges page and invoices need no changes.
export const CHARGE_TYPE: Record<TollKind, "toll" | "ticket"> = { toll: "toll", citation: "ticket" };

export function totalToCharge(amount: number, fee: number): number {
  return Math.round((amount + fee) * 100) / 100;
}

/** Whole dollars and cents only: positive, at most two decimals, and sane. */
export function parseMoney(text: string): number | null {
  const t = text.trim().replace(/^\$/, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/**
 * Turns what a staff member typed into a datetime-local box ("2026-10-09T14:30",
 * no time zone) into a real moment, reading it as Central time (Nashville).
 * Handles daylight saving: two passes settle the offset.
 */
export function localToIso(value: string, timeZone = "America/Chicago"): string | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(asUtc).getUTCMonth() !== mo - 1) return null; // e.g. 2026-02-31

  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return shown - Math.floor(ms / 1000) * 1000;
  };

  let guess = asUtc - offsetAt(asUtc);
  guess = asUtc - offsetAt(guess);
  return new Date(guess).toISOString();
}

export type RentalWindow = { rentalId: string; customerId: string; startAt: string | null; endAt: string | null };

/**
 * The rental that had the car at `occurredAt`: started on or before it, and not
 * yet returned (or returned after it). If windows overlap, the latest start wins.
 */
export function matchRental(windows: RentalWindow[], occurredAt: string): RentalWindow | null {
  const t = Date.parse(occurredAt);
  if (!Number.isFinite(t)) return null;
  const hits = windows.filter((w) => {
    if (!w.startAt) return false;
    const start = Date.parse(w.startAt);
    const end = w.endAt ? Date.parse(w.endAt) : Infinity;
    return start <= t && t <= end;
  });
  hits.sort((a, b) => Date.parse(b.startAt as string) - Date.parse(a.startAt as string));
  return hits[0] ?? null;
}
