// Cost per lead / application / picked-up renter, by channel. Pure functions, unit tested.
// Spend is entered per calendar month; for a window that covers part of a month, the month's spend is pro-rated
// by the days that overlap (an even-spread assumption, stated on the page).

import { num, round2, type FunnelSourceRow } from "./analytics";

export type SpendRow = { month: string; source: string; amount: unknown }; // month = YYYY-MM-01

export const MIN_LEADS_TO_JUDGE = 20;

/** Spend per source inside [from, to), pro-rating each month by overlapping days. */
export function spendBySource(rows: SpendRow[], from: Date, to: Date): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!/^\d{4}-\d{2}-01$/.test(r.month)) continue;
    const start = new Date(`${r.month}T00:00:00.000Z`);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const overlap = Math.min(end.getTime(), to.getTime()) - Math.max(start.getTime(), from.getTime());
    if (overlap <= 0) continue;
    const share = overlap / (end.getTime() - start.getTime());
    out.set(r.source, (out.get(r.source) ?? 0) + num(r.amount) * share);
  }
  for (const [k, v] of out) out.set(k, round2(v));
  return out;
}

export type ChannelRow = FunnelSourceRow & {
  spend: number;
  costPerLead: number | null;
  costPerApplication: number | null;
  costPerPickup: number | null;
  enoughData: boolean;
};

const per = (spend: number, n: number): number | null => (spend > 0 && n > 0 ? round2(spend / n) : null);

/** Funnel rows plus spend. A channel with spend but no leads still appears, so wasted spend is visible. */
export function channelRows(funnel: FunnelSourceRow[], spend: Map<string, number>): ChannelRow[] {
  const labels = new Set(funnel.map((f) => f.label));
  const rows: FunnelSourceRow[] = [...funnel];
  for (const s of spend.keys()) if (!labels.has(s)) rows.push({ label: s, leads: 0, applied: 0, approved: 0, pickedUp: 0 });
  return rows.map((f) => {
    const sp = spend.get(f.label) ?? 0;
    return { ...f, spend: sp, costPerLead: per(sp, f.leads), costPerApplication: per(sp, f.applied), costPerPickup: per(sp, f.pickedUp), enoughData: f.leads >= MIN_LEADS_TO_JUDGE };
  });
}

export type Verdict = "more" | "keep" | "cut" | "wait" | "free";

/**
 * Simple, explainable ranking for paid channels with enough leads:
 *  - cheapest cost per picked-up renter first
 *  - "more": cost per pickup is at most 70% of the paid-channel average; "cut": spend with no pickups or over 130%
 * Channels with no spend are "free"; paid channels with too few leads are "wait".
 */
export function rankChannels(rows: ChannelRow[]): { row: ChannelRow; verdict: Verdict }[] {
  const paid = rows.filter((r) => r.spend > 0);
  const totalSpend = paid.reduce((a, r) => a + r.spend, 0);
  const totalPickups = paid.reduce((a, r) => a + r.pickedUp, 0);
  const avg = totalPickups > 0 ? totalSpend / totalPickups : null;
  const withVerdict = rows.map((row) => {
    let verdict: Verdict;
    if (row.spend <= 0) verdict = "free";
    else if (!row.enoughData) verdict = "wait";
    else if (row.costPerPickup === null) verdict = "cut";
    else if (avg !== null && paid.length > 1 && row.costPerPickup <= avg * 0.7) verdict = "more";
    else if (avg !== null && paid.length > 1 && row.costPerPickup > avg * 1.3) verdict = "cut";
    else verdict = "keep";
    return { row, verdict };
  });
  const order: Record<Verdict, number> = { more: 0, keep: 1, wait: 2, cut: 3, free: 4 };
  return withVerdict.sort((a, b) =>
    order[a.verdict] - order[b.verdict] || (a.row.costPerPickup ?? Infinity) - (b.row.costPerPickup ?? Infinity) || a.row.label.localeCompare(b.row.label));
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  more: "Spend more",
  keep: "Keep as is",
  wait: "Too few leads to judge",
  cut: "Cut or fix",
  free: "No spend entered",
};

/** The month's first day (UTC) as YYYY-MM-01 for a YYYY-MM or YYYY-MM-DD input, or null. */
export function monthStart(input: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(input.trim());
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? `${m[1]}-${m[2]}-01` : null;
}

