// Weekly card billing: what was due each week against what was collected, plus what is coming.
// Source: billing_attempt (one row per try; up to 4 tries per due date) and payment_schedule (the NEXT due date only).
// Covers automatic weekly card billing. The first payment and any payment recorded by hand are not "billed" here;
// they show in the cash charts above. Pure functions, unit tested.

import { DAY_MS, isoDay, num, round2, weekStart, weekStarts } from "./analytics";

export type AttemptRow = { schedule_id: string; due_at: string; amount_cents: unknown; status: string };
export type ScheduleRow = { status: string; cadence: string; billing_paused: boolean; next_due_at: string | null; amount: unknown };

export type DueWeek = { start: string; due: number; collected: number; open: number };

/**
 * One charge per (schedule, due date), however many tries it took. It counts as collected if any try succeeded,
 * and is placed in the week of its due date. Everything else is still open.
 */
export function dueVsCollected(attempts: AttemptRow[], from: Date, to: Date): { weeks: DueWeek[]; due: number; collected: number; open: number; collectedPct: number | null } {
  const charges = new Map<string, { due_at: string; cents: number; collected: boolean }>();
  for (const a of attempts) {
    const key = `${a.schedule_id}|${a.due_at}`;
    const c = charges.get(key) ?? { due_at: a.due_at, cents: 0, collected: false };
    c.cents = Math.max(c.cents, num(a.amount_cents));
    if (a.status === "succeeded") c.collected = true;
    charges.set(key, c);
  }
  const weeks = new Map<string, DueWeek>(weekStarts(from, to).map((s) => [s, { start: s, due: 0, collected: 0, open: 0 }]));
  for (const c of charges.values()) {
    const t = new Date(c.due_at).getTime();
    if (t < from.getTime() || t >= to.getTime()) continue;
    const w = weeks.get(isoDay(weekStart(new Date(c.due_at))));
    if (!w) continue;
    const amount = c.cents / 100;
    w.due += amount;
    if (c.collected) w.collected += amount;
    else w.open += amount;
  }
  const list = [...weeks.values()].map((w) => ({ ...w, due: round2(w.due), collected: round2(w.collected), open: round2(w.open) }));
  const due = round2(list.reduce((a, w) => a + w.due, 0));
  const collected = round2(list.reduce((a, w) => a + w.collected, 0));
  return { weeks: list, due, collected, open: round2(due - collected), collectedPct: due > 0 ? Math.round((collected / due) * 100) : null };
}

/** Weekly card charges coming due in the next `days` days (paused and ended schedules excluded). */
export function dueSoon(schedules: ScheduleRow[], now: Date, days = 14): { amount: number; count: number; nextAt: string | null } {
  const end = now.getTime() + days * DAY_MS;
  let amount = 0;
  let count = 0;
  let nextAt: string | null = null;
  for (const s of schedules) {
    if (s.status !== "active" || s.cadence !== "weekly" || s.billing_paused || !s.next_due_at) continue;
    const t = new Date(s.next_due_at).getTime();
    if (t > end) continue;
    amount += num(s.amount);
    count++;
    if (!nextAt || s.next_due_at < nextAt) nextAt = s.next_due_at;
  }
  return { amount: round2(amount), count, nextAt };
}
