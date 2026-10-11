// Per-person activity for the team scorecard. Pure functions, unit tested.
// Source: audit_event (who did what) and communication_event.handled_by (messages marked handled).
// Not every action in the app writes an audit row yet, so these counts are a floor, not a full record of work.

import { isoDay, median, round2, weekStart, weekStarts } from "./analytics";

export type AuditRow = { actor_user_id: string | null; action: string; entity_id: string | null; created_at: string };
export type HandledRow = { handled_by: string | null; created_at: string; handled_at: string | null };
export type SubmittedMap = Map<string, string>; // application id -> submitted_at

export const CATEGORIES = ["Applications", "Payments & charges", "Pickups & runners", "Fleet & maintenance", "Flags & bans", "Messages handled", "Other"] as const;
export type Category = (typeof CATEGORIES)[number];

export function categorize(action: string): Category {
  if (action === "application_decision") return "Applications";
  if (/^(payment_|charge_|toll_|referral_credit)/.test(action) || action === "payment_recorded") return "Payments & charges";
  if (/^rental_(pickup|dropoff|runner)/.test(action)) return "Pickups & runners";
  if (/^(maintenance_|incident_|damage_)/.test(action)) return "Fleet & maintenance";
  if (/^(red_flag_|do_not_rent_)/.test(action)) return "Flags & bans";
  return "Other";
}

const inRange = (iso: string, from: Date, to: Date) => {
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
};

export type PersonRow = {
  userId: string;
  total: number;
  byCategory: Record<Category, number>;
  decided: number;
  medianHoursToDecide: number | null;
  messagesHandled: number;
  medianMinutesToHandle: number | null;
  lastActive: string | null;
};

const emptyCats = (): Record<Category, number> => ({ Applications: 0, "Payments & charges": 0, "Pickups & runners": 0, "Fleet & maintenance": 0, "Flags & bans": 0, "Messages handled": 0, Other: 0 });

/** One row per person who did anything in the range, busiest first. Automated/system rows (no actor) are ignored. */
export function personRows(audit: AuditRow[], handled: HandledRow[], submitted: SubmittedMap, from: Date, to: Date): PersonRow[] {
  const people = new Map<string, PersonRow & { _hours: number[]; _mins: number[] }>();
  const get = (id: string) => {
    let p = people.get(id);
    if (!p) {
      p = { userId: id, total: 0, byCategory: emptyCats(), decided: 0, medianHoursToDecide: null, messagesHandled: 0, medianMinutesToHandle: null, lastActive: null, _hours: [], _mins: [] };
      people.set(id, p);
    }
    return p;
  };
  const touch = (p: PersonRow, iso: string) => {
    if (!p.lastActive || iso > p.lastActive) p.lastActive = iso;
  };
  for (const a of audit) {
    if (!a.actor_user_id || !inRange(a.created_at, from, to)) continue;
    const p = get(a.actor_user_id);
    p.total += 1;
    p.byCategory[categorize(a.action)] += 1;
    touch(p, a.created_at);
    if (a.action === "application_decision") {
      p.decided += 1;
      const sub = a.entity_id ? submitted.get(a.entity_id) : undefined;
      if (sub) {
        const h = (new Date(a.created_at).getTime() - new Date(sub).getTime()) / 3_600_000;
        if (h >= 0) p._hours.push(h);
      }
    }
  }
  for (const h of handled) {
    if (!h.handled_by || !h.handled_at || !inRange(h.handled_at, from, to)) continue;
    const p = get(h.handled_by);
    p.total += 1;
    p.messagesHandled += 1;
    p.byCategory["Messages handled"] += 1;
    touch(p, h.handled_at);
    const m = (new Date(h.handled_at).getTime() - new Date(h.created_at).getTime()) / 60_000;
    if (m >= 0) p._mins.push(m);
  }
  return [...people.values()]
    .map(({ _hours, _mins, ...p }) => {
      const mh = median(_hours);
      const mm = median(_mins);
      return { ...p, medianHoursToDecide: mh === null ? null : round2(mh), medianMinutesToHandle: mm === null ? null : Math.round(mm) };
    })
    .sort((a, b) => b.total - a.total || a.userId.localeCompare(b.userId));
}

/** Actions per Monday-week for one person (audit rows plus messages handled). */
export function personWeekly(userId: string, audit: AuditRow[], handled: HandledRow[], from: Date, to: Date): { start: string; count: number }[] {
  const weeks = new Map<string, number>(weekStarts(from, to).map((s) => [s, 0]));
  const bump = (iso: string) => {
    const k = isoDay(weekStart(new Date(iso)));
    if (weeks.has(k)) weeks.set(k, (weeks.get(k) ?? 0) + 1);
  };
  for (const a of audit) if (a.actor_user_id === userId && inRange(a.created_at, from, to)) bump(a.created_at);
  for (const h of handled) if (h.handled_by === userId && h.handled_at && inRange(h.handled_at, from, to)) bump(h.handled_at);
  return [...weeks.entries()].map(([start, count]) => ({ start, count }));
}

const LABELS: Record<string, string> = {
  application_decision: "Decided an application",
  payment_recorded: "Recorded a payment",
  rental_pickup_confirmed: "Confirmed a pickup",
  rental_dropoff_confirmed: "Confirmed a drop-off",
  rental_runner_assigned: "Assigned a runner",
  toll_charged: "Charged a toll",
  toll_marked_paid: "Marked a toll paid",
  charge_logged: "Logged a charge",
  charge_approved: "Approved a charge",
  maintenance_work_order_created: "Opened a work order",
  maintenance_work_order_completed: "Completed a work order",
  maintenance_job_started: "Started a maintenance job",
  maintenance_job_approved: "Approved a maintenance job",
  incident_logged: "Logged an incident",
  incident_resolved: "Resolved an incident",
  red_flag_added: "Added a red flag",
  red_flag_resolved: "Resolved a red flag",
  do_not_rent_added: "Added to do-not-rent",
  do_not_rent_lifted: "Lifted a do-not-rent",
  pricing_updated: "Changed pricing",
  data_exported: "Exported data",
};

export function actionLabel(action: string): string {
  return LABELS[action] ?? action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Newest first, for the drill-down list. */
export function recentActions(userId: string, audit: AuditRow[], limit = 25): { label: string; at: string }[] {
  return audit
    .filter((a) => a.actor_user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
    .map((a) => ({ label: actionLabel(a.action), at: a.created_at }));
}
