// Numbers behind the Business and Work queue pages. Pure functions: rows in, numbers out, so every rule here is
// unit tested and an empty database just gives empty results (the pages draw an empty state, never an error).
// Dates are handled in UTC; weeks start on Monday.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const PRESET_DAYS = [7, 30, 90] as const;

export type Range = {
  from: Date; // inclusive
  to: Date; // exclusive
  days: number;
  prevFrom: Date;
  prevTo: Date;
  key: string; // preset like "30" or "custom"
  label: string;
};

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseDay(s: string | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ?days=7|30|90, or ?from=YYYY-MM-DD&to=YYYY-MM-DD (to is inclusive, at most 366 days). Anything else means 30 days. */
export function parseRange(sp: { days?: string; from?: string; to?: string }, now: Date = new Date()): Range {
  const today = startOfUtcDay(now);
  const from = parseDay(sp.from);
  const toIncl = parseDay(sp.to);
  if (from && toIncl && from <= toIncl) {
    const to = new Date(toIncl.getTime() + DAY_MS);
    const days = Math.round((to.getTime() - from.getTime()) / DAY_MS);
    if (days <= 366) {
      return { from, to, days, prevFrom: new Date(from.getTime() - days * DAY_MS), prevTo: from, key: "custom", label: `${isoDay(from)} to ${isoDay(toIncl)}` };
    }
  }
  const asked = Number(sp.days);
  const days = (PRESET_DAYS as readonly number[]).includes(asked) ? asked : 30;
  const to = new Date(today.getTime() + DAY_MS); // includes today
  const f = new Date(to.getTime() - days * DAY_MS);
  return { from: f, to, days, prevFrom: new Date(f.getTime() - days * DAY_MS), prevTo: f, key: String(days), label: `Last ${days} days` };
}

export function weekStart(d: Date): Date {
  const day = startOfUtcDay(d);
  const dow = (day.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(day.getTime() - dow * DAY_MS);
}

/** Monday dates (ISO) of every week that touches the range. */
export function weekStarts(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let w = weekStart(from); w < to; w = new Date(w.getTime() + 7 * DAY_MS)) out.push(isoDay(w));
  return out;
}

export function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** "+12%" / "-8%" against the previous period; null when there is nothing to compare with. */
export function changePct(current: number, previous: number): number | null {
  if (!(previous > 0)) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// ---------------------------------------------------------------------------------------------------------------
// Money: cash collected vs refunded, per week

export type PaymentRow = { amount: unknown; kind: string; status: string; paid_at: string | null };
export type RefundRow = { status: string; rent_refund_cents: number | null; deposit_refund_cents: number | null; completed_at: string | null };

export type CashWeek = { start: string; rent: number; refunds: number; net: number };
export type CashSummary = { weeks: CashWeek[]; rent: number; refunds: number; net: number; depositsReceived: number };

const inRange = (iso: string | null, from: Date, to: Date): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
};

/**
 * Cash collected from rent (paid payments), minus the rent part of refunds that went out. Deposits are not income:
 * they are counted separately. A refund only counts once it has actually succeeded.
 */
export function cashSummary(payments: PaymentRow[], refunds: RefundRow[], from: Date, to: Date): CashSummary {
  const weeks = new Map<string, CashWeek>(weekStarts(from, to).map((s) => [s, { start: s, rent: 0, refunds: 0, net: 0 }]));
  let depositsReceived = 0;
  for (const p of payments) {
    if (p.status !== "paid" || !inRange(p.paid_at, from, to)) continue;
    const amount = num(p.amount);
    if (p.kind === "deposit") depositsReceived += amount;
    else weeks.get(isoDay(weekStart(new Date(p.paid_at!))))!.rent += amount;
  }
  for (const r of refunds) {
    if (r.status !== "succeeded" || !inRange(r.completed_at, from, to)) continue;
    weeks.get(isoDay(weekStart(new Date(r.completed_at!))))!.refunds += num(r.rent_refund_cents) / 100;
  }
  const list = [...weeks.values()].map((w) => ({ ...w, rent: round2(w.rent), refunds: round2(w.refunds), net: round2(w.rent - w.refunds) }));
  const rent = round2(list.reduce((a, w) => a + w.rent, 0));
  const refundsTotal = round2(list.reduce((a, w) => a + w.refunds, 0));
  return { weeks: list, rent, refunds: refundsTotal, net: round2(rent - refundsTotal), depositsReceived: round2(depositsReceived) };
}

export type Collections = { paidThisPeriod: number; upcoming: number; atRisk: number; atRiskCount: number };

const AT_RISK = new Set(["failed", "retrying", "delinquent", "manual_review"]);
const UPCOMING = new Set(["scheduled", "processing"]);

/** What is owed but not yet collected, right now. Rent payments only. */
export function collections(payments: PaymentRow[], from: Date, to: Date): Collections {
  let paid = 0, upcoming = 0, atRisk = 0, atRiskCount = 0;
  for (const p of payments) {
    if (p.kind === "deposit") continue;
    const a = num(p.amount);
    if (p.status === "paid") {
      if (inRange(p.paid_at, from, to)) paid += a;
    } else if (AT_RISK.has(p.status)) {
      atRisk += a;
      atRiskCount++;
    } else if (UPCOMING.has(p.status)) upcoming += a;
  }
  return { paidThisPeriod: round2(paid), upcoming: round2(upcoming), atRisk: round2(atRisk), atRiskCount };
}

/** Deposits received minus deposits refunded: roughly what is held for renters. */
export function depositsHeld(payments: PaymentRow[], refunds: RefundRow[]): number {
  let held = 0;
  for (const p of payments) if (p.kind === "deposit" && p.status === "paid") held += num(p.amount);
  for (const r of refunds) if (r.status === "succeeded") held -= num(r.deposit_refund_cents) / 100;
  return round2(Math.max(0, held));
}

// ---------------------------------------------------------------------------------------------------------------
// Fleet utilization

export type RentalRow = {
  status: string;
  pickup_confirmed_at: string | null;
  actual_return_at: string | null;
  expected_return_at: string | null;
};

const NOT_ON_ROAD = new Set(["pending", "approved", "scheduled", "cancelled"]);

/** Percent of car-days out on rent, per week. A rental that is past its due date and not back counts until now. */
export function weeklyUtilization(rentals: RentalRow[], fleetSize: number, from: Date, to: Date, now: Date = new Date()): { start: string; pct: number }[] {
  const starts = weekStarts(from, to);
  return starts.map((s) => {
    if (fleetSize <= 0) return { start: s, pct: 0 };
    const ws = new Date(`${s}T00:00:00.000Z`).getTime();
    const we = ws + 7 * DAY_MS;
    let days = 0;
    for (const r of rentals) {
      if (!r.pickup_confirmed_at || NOT_ON_ROAD.has(r.status)) continue;
      const begin = new Date(r.pickup_confirmed_at).getTime();
      const endIso = r.actual_return_at ?? null;
      const end = endIso ? new Date(endIso).getTime() : Math.max(now.getTime(), r.expected_return_at ? new Date(r.expected_return_at).getTime() : 0);
      const overlap = Math.min(end, we, now.getTime()) - Math.max(begin, ws);
      if (overlap > 0) days += overlap / DAY_MS;
    }
    return { start: s, pct: Math.min(100, Math.round((days / (fleetSize * 7)) * 100)) };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Lead funnel and AI calls

export type FunnelSourceRow = { label: string; leads: number; applied: number; approved: number; pickedUp: number };

export function funnelRows(raw: { label: string; leads_count: unknown; applied_count: unknown; approved_count: unknown; picked_up_count: unknown }[]): FunnelSourceRow[] {
  return raw
    .map((r) => ({ label: r.label, leads: num(r.leads_count), applied: num(r.applied_count), approved: num(r.approved_count), pickedUp: num(r.picked_up_count) }))
    .sort((a, b) => b.pickedUp - a.pickedUp || b.leads - a.leads);
}

export const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);

export type CallRow = { assistant_key: string; metrics: { outcome?: string | null } | null };
export type CallSummary = {
  total: number;
  byAssistant: { assistant: string; calls: number; positive: number; needsHuman: number }[];
};

// Outcomes that mean the caller moved forward. Names come from each assistant's end-of-call report.
const POSITIVE = new Set(["application_completed_live", "committed_to_complete", "completed_live", "committed_to_finish", "confirmed"]);
const HUMAN = new Set(["needs_help_from_staff", "needs_reschedule", "interested_needs_followup"]);

export function callSummary(rows: CallRow[]): CallSummary {
  const m = new Map<string, { calls: number; positive: number; needsHuman: number }>();
  for (const r of rows) {
    const a = m.get(r.assistant_key) ?? { calls: 0, positive: 0, needsHuman: 0 };
    a.calls++;
    const o = r.metrics?.outcome ?? "";
    if (POSITIVE.has(o)) a.positive++;
    if (HUMAN.has(o)) a.needsHuman++;
    m.set(r.assistant_key, a);
  }
  return { total: rows.length, byAssistant: [...m.entries()].map(([assistant, v]) => ({ assistant, ...v })).sort((a, b) => b.calls - a.calls) };
}

// ---------------------------------------------------------------------------------------------------------------
// Work queue (is the team keeping up?)

export type AppRow = { status: string; submitted_at: string | null; decision_at: string | null };
const WAITING = new Set(["submitted", "screening", "review"]);

export const AGING_BUCKETS = ["Under 4 hours", "4 to 24 hours", "1 to 2 days", "Over 2 days"] as const;

export function applicationAging(apps: AppRow[], now: Date = new Date()): { buckets: { label: string; count: number }[]; waiting: number; oldestHours: number | null } {
  const counts = [0, 0, 0, 0];
  let oldest: number | null = null;
  let waiting = 0;
  for (const a of apps) {
    if (!WAITING.has(a.status) || !a.submitted_at) continue;
    const h = Math.max(0, (now.getTime() - new Date(a.submitted_at).getTime()) / 3600000);
    waiting++;
    oldest = oldest === null ? h : Math.max(oldest, h);
    counts[h < 4 ? 0 : h < 24 ? 1 : h < 48 ? 2 : 3]++;
  }
  return { buckets: AGING_BUCKETS.map((label, i) => ({ label, count: counts[i] })), waiting, oldestHours: oldest === null ? null : Math.round(oldest) };
}

/** Median hours from submit to decision for applications decided in [from, to). */
export function medianDecisionHours(apps: AppRow[], from: Date, to: Date): { median: number | null; decided: number } {
  const hours: number[] = [];
  for (const a of apps) {
    if (!a.submitted_at || !a.decision_at || !inRange(a.decision_at, from, to)) continue;
    const h = (new Date(a.decision_at).getTime() - new Date(a.submitted_at).getTime()) / 3600000;
    if (h >= 0) hours.push(h);
  }
  const m = median(hours);
  return { median: m === null ? null : Math.round(m * 10) / 10, decided: hours.length };
}

export type InboxEvent = {
  customer_id: string | null;
  lead_id: string | null;
  direction: string;
  event_type: string;
  created_at: string;
  handled_at: string | null;
  payload?: { from?: string } | null;
};

/**
 * Time to answer: for each message a customer sent in the range, the minutes until the next message the team sent
 * in the same conversation. Messages never answered (and not marked handled) are counted separately.
 */
export function inboxResponse(events: InboxEvent[], from: Date, to: Date, now: Date = new Date()): { medianMinutes: number | null; answered: number; unanswered: number; slowOver4h: number } {
  const key = (e: InboxEvent) => (e.customer_id ? `c:${e.customer_id}` : e.lead_id ? `l:${e.lead_id}` : `u:${e.payload?.from ?? "unknown"}`);
  const byConv = new Map<string, InboxEvent[]>();
  for (const e of events) {
    if (e.event_type !== "message") continue;
    const list = byConv.get(key(e)) ?? [];
    list.push(e);
    byConv.set(key(e), list);
  }
  const minutes: number[] = [];
  let unanswered = 0;
  for (const list of byConv.values()) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    list.forEach((e, i) => {
      if (e.direction !== "inbound" || !inRange(e.created_at, from, to)) return;
      const reply = list.slice(i + 1).find((x) => x.direction === "outbound");
      if (reply) minutes.push((new Date(reply.created_at).getTime() - new Date(e.created_at).getTime()) / 60000);
      else if (!e.handled_at && now.getTime() - new Date(e.created_at).getTime() > 0) unanswered++;
    });
  }
  const m = median(minutes);
  return { medianMinutes: m === null ? null : Math.round(m), answered: minutes.length, unanswered, slowOver4h: minutes.filter((x) => x > 240).length };
}

/** Counts of rentals starting on each of the next `days` days (UTC dates). */
export function pickupsByDay(starts: (string | null)[], now: Date, days = 7): { day: string; count: number }[] {
  const base = startOfUtcDay(now);
  const out = Array.from({ length: days }, (_, i) => ({ day: isoDay(new Date(base.getTime() + i * DAY_MS)), count: 0 }));
  for (const s of starts) {
    if (!s) continue;
    const d = isoDay(new Date(s));
    const slot = out.find((o) => o.day === d);
    if (slot) slot.count++;
  }
  return out;
}

/** Round up to a clean axis maximum (10, 20, 50, 100, 200, 500 ...). */
export function niceMax(v: number): number {
  if (!(v > 0)) return 10;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return step * exp;
}

export function formatMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatHours(h: number | null): string {
  if (h === null) return "–";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h % 1 === 0 ? h : h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}
