// Profit per car, from real cash only (no depreciation). Pure functions, unit tested; an empty database gives an empty list.
//
// For a date range [from, to):
//   revenue  = rent actually collected on the car, minus rent refunded on it
//   costs    = completed maintenance + tolls/tickets Zivo absorbed (waived) + loan + insurance + other recurring,
//              the recurring ones pro-rated by days owned in the range (30.4375 days per month)
//   before   = revenue - costs
//   after    = before, less the JV partner's share. The partner takes a share of a profit only; a loss stays with Zivo.
// A payment belongs to the car the renter was in when it was paid (the latest rental segment that had started),
// or the first segment if it was paid before any started.

import { DAY_MS, num, round2 } from "./analytics";

export const DAYS_PER_MONTH = 30.4375;

export type CostRow = {
  vehicle_id: string;
  purchase_price: unknown;
  purchased_on: string | null;
  monthly_loan: unknown;
  monthly_insurance: unknown;
  monthly_other: unknown;
  partner_share_pct: unknown;
};
export type CarRow = { id: string; year: number | null; make: string | null; model: string | null; plate: string | null; status: string };
export type SegmentRow = { rental_id: string; vehicle_id: string; starts_at: string };
export type CarPayment = { rental_id: string | null; amount: unknown; kind: string; status: string; paid_at: string | null };
export type CarRefund = { rental_id: string | null; status: string; rent_refund_cents: number | null; completed_at: string | null };
export type WorkOrderRow = { vehicle_id: string; status: string; cost: unknown; downtime_end: string | null; approved_at: string | null };
export type TollRow = { vehicle_id: string | null; status: string; amount: unknown; created_at: string };

export type CarProfit = {
  id: string;
  label: string;
  hasCosts: boolean; // false until the owner has entered this car's costs
  revenue: number;
  maintenance: number;
  tolls: number;
  loan: number;
  insurance: number;
  other: number;
  costs: number;
  before: number;
  partnerPct: number;
  partnerShare: number;
  after: number;
};

const inRange = (iso: string | null, from: Date, to: Date): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
};

export function carLabel(c: CarRow): string {
  const name = [c.year, c.make, c.model].filter(Boolean).join(" ") || "Vehicle";
  return c.plate ? `${name} (${c.plate})` : name;
}

/** Which car was a rental in at a given moment. */
export function vehicleAt(segments: SegmentRow[], at: string | null): string | null {
  if (segments.length === 0) return null;
  const sorted = [...segments].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (!at) return sorted[sorted.length - 1].vehicle_id;
  const t = new Date(at).getTime();
  let pick = sorted[0];
  for (const s of sorted) if (new Date(s.starts_at).getTime() <= t) pick = s;
  return pick.vehicle_id;
}

/** Days of [from, to) the car has been owned (from purchased_on, or the whole range when no date is entered). */
export function ownedDays(purchasedOn: string | null, from: Date, to: Date): number {
  let start = from.getTime();
  if (purchasedOn && /^\d{4}-\d{2}-\d{2}$/.test(purchasedOn)) start = Math.max(start, new Date(`${purchasedOn}T00:00:00.000Z`).getTime());
  return Math.max(0, (to.getTime() - start) / DAY_MS);
}

export function carProfit(
  cars: CarRow[], costs: CostRow[], segments: SegmentRow[], payments: CarPayment[], refunds: CarRefund[],
  orders: WorkOrderRow[], tolls: TollRow[], from: Date, to: Date,
): CarProfit[] {
  const costBy = new Map(costs.map((c) => [c.vehicle_id, c]));
  const segByRental = new Map<string, SegmentRow[]>();
  for (const s of segments) segByRental.set(s.rental_id, [...(segByRental.get(s.rental_id) ?? []), s]);

  const rows = new Map<string, CarProfit>();
  for (const c of cars) {
    rows.set(c.id, { id: c.id, label: carLabel(c), hasCosts: costBy.has(c.id), revenue: 0, maintenance: 0, tolls: 0, loan: 0, insurance: 0, other: 0, costs: 0, before: 0, partnerPct: 0, partnerShare: 0, after: 0 });
  }

  for (const p of payments) {
    if (p.kind !== "rent" || p.status !== "paid" || !p.rental_id || !inRange(p.paid_at, from, to)) continue;
    const id = vehicleAt(segByRental.get(p.rental_id) ?? [], p.paid_at);
    const row = id ? rows.get(id) : undefined;
    if (row) row.revenue += num(p.amount);
  }
  for (const r of refunds) {
    if (r.status !== "succeeded" || !r.rental_id || !inRange(r.completed_at, from, to)) continue;
    const id = vehicleAt(segByRental.get(r.rental_id) ?? [], r.completed_at);
    const row = id ? rows.get(id) : undefined;
    if (row) row.revenue -= num(r.rent_refund_cents) / 100;
  }
  for (const w of orders) {
    if (w.status !== "completed" || !inRange(w.downtime_end ?? w.approved_at, from, to)) continue;
    const row = rows.get(w.vehicle_id);
    if (row) row.maintenance += num(w.cost);
  }
  for (const t of tolls) {
    if (t.status !== "waived" || !t.vehicle_id || !inRange(t.created_at, from, to)) continue;
    const row = rows.get(t.vehicle_id);
    if (row) row.tolls += num(t.amount);
  }

  const out: CarProfit[] = [];
  for (const row of rows.values()) {
    const c = costBy.get(row.id);
    if (c) {
      const months = ownedDays(c.purchased_on, from, to) / DAYS_PER_MONTH;
      row.loan = num(c.monthly_loan) * months;
      row.insurance = num(c.monthly_insurance) * months;
      row.other = num(c.monthly_other) * months;
      row.partnerPct = Math.min(100, Math.max(0, num(c.partner_share_pct)));
    }
    row.revenue = round2(row.revenue);
    row.maintenance = round2(row.maintenance);
    row.tolls = round2(row.tolls);
    row.loan = round2(row.loan);
    row.insurance = round2(row.insurance);
    row.other = round2(row.other);
    row.costs = round2(row.maintenance + row.tolls + row.loan + row.insurance + row.other);
    row.before = round2(row.revenue - row.costs);
    row.partnerShare = row.before > 0 ? round2((row.before * row.partnerPct) / 100) : 0;
    row.after = round2(row.before - row.partnerShare);
    out.push(row);
  }
  // Worst first, so the cars losing money are at the top.
  return out.sort((a, b) => a.before - b.before || a.label.localeCompare(b.label));
}

export function carProfitTotals(rows: CarProfit[]): { revenue: number; costs: number; before: number; partnerShare: number; after: number; losing: number } {
  const sum = (f: (r: CarProfit) => number) => round2(rows.reduce((a, r) => a + f(r), 0));
  return { revenue: sum((r) => r.revenue), costs: sum((r) => r.costs), before: sum((r) => r.before), partnerShare: sum((r) => r.partnerShare), after: sum((r) => r.after), losing: rows.filter((r) => r.before < 0).length };
}
