// The Monday owner email. Pure functions: numbers in, subject/text/html out, so the wording and the
// "needs your attention" rules are unit tested. Everything printed is escaped.

import { DAY_MS, changePct, formatMoney, weekStart, type Range } from "./analytics";

/** The last complete Monday-to-Sunday week (UTC) before `now`, and the week before it. */
export function lastFullWeek(now: Date): Range {
  const to = weekStart(now); // this Monday 00:00 UTC, exclusive
  const from = new Date(to.getTime() - 7 * DAY_MS);
  const last = new Date(to.getTime() - DAY_MS);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return { from, to, days: 7, prevFrom: new Date(from.getTime() - 7 * DAY_MS), prevTo: from, key: "week", label: `${fmt(from)} to ${fmt(last)}` };
}

export type SummaryInput = {
  weekLabel: string;
  links: { business: string; workQueue: string };
  rent: number; prevRent: number;
  refunds: number;
  net: number; prevNet: number;
  atRisk: number; atRiskCount: number; upcoming: number;
  utilizationPct: number | null;
  leads: number; applied: number; pickedUp: number;
  waitingApps: number; oldestWaitingHours: number | null;
  unansweredMessages: number;
  carsLosing: string[];
  carProfitBefore: number; carProfitAfter: number; carsWithoutCosts: number;
  adSpend: number; costPerPickup: number | null;
  adMore: string[]; adCut: string[];
  miles: number; trips: number;
  trackers: { reporting: number; withTracker: number; fleetSize: number };
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => formatMoney(n);
const change = (cur: number, prev: number): string => {
  const c = changePct(cur, prev);
  return c === null ? "" : ` (${c > 0 ? "+" : ""}${c}% vs the week before)`;
};
const list = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Things that need the owner this week, most urgent first. Empty list means a quiet week. */
export function attentionItems(i: SummaryInput): string[] {
  const out: string[] = [];
  if (i.atRiskCount > 0) out.push(`${money(i.atRisk)} of rent is failed or overdue (${i.atRiskCount} payment${i.atRiskCount === 1 ? "" : "s"}).`);
  if (i.waitingApps > 0 && (i.oldestWaitingHours ?? 0) >= 24) out.push(`${i.waitingApps} application${i.waitingApps === 1 ? " is" : "s are"} waiting; the oldest has waited ${Math.round(i.oldestWaitingHours ?? 0)} hours.`);
  if (i.unansweredMessages > 0) out.push(`${i.unansweredMessages} customer message${i.unansweredMessages === 1 ? " has" : "s have"} no reply yet.`);
  if (i.carsLosing.length > 0) out.push(`${list(i.carsLosing)} lost money this week.`);
  if (i.adCut.length > 0) out.push(`Ad spend to cut or fix: ${list(i.adCut)}.`);
  if (i.adMore.length > 0) out.push(`Ad spend worth increasing: ${list(i.adMore)}.`);
  if (i.trackers.fleetSize > i.trackers.withTracker) out.push(`${i.trackers.fleetSize - i.trackers.withTracker} car${i.trackers.fleetSize - i.trackers.withTracker === 1 ? " has" : "s have"} no GPS tracker.`);
  else if (i.trackers.reporting < i.trackers.withTracker) out.push(`${i.trackers.withTracker - i.trackers.reporting} tracker${i.trackers.withTracker - i.trackers.reporting === 1 ? " has" : "s have"} not reported in 24 hours.`);
  if (i.carsWithoutCosts > 0) out.push(`${i.carsWithoutCosts} car${i.carsWithoutCosts === 1 ? " has" : "s have"} no costs entered, so profit is overstated.`);
  return out;
}

export function buildWeeklySummary(i: SummaryInput): { subject: string; text: string; html: string; attention: string[] } {
  const attention = attentionItems(i);
  const rows: [string, string][] = [
    ["Rent collected", `${money(i.rent)}${change(i.rent, i.prevRent)}`],
    ["Refunded (rent)", money(i.refunds)],
    ["Net cash", `${money(i.net)}${change(i.net, i.prevNet)}`],
    ["Still to collect", `${money(i.upcoming)} scheduled`],
    ["Fleet in use", i.utilizationPct === null ? "–" : `${i.utilizationPct}% of cars`],
    ["Leads → applied → picked up", `${i.leads} → ${i.applied} → ${i.pickedUp}`],
    ["Car profit (cash only)", `${money(i.carProfitBefore)} before owner splits, ${money(i.carProfitAfter)} Zivo keeps`],
    ["Ad spend", i.adSpend > 0 ? `${money(i.adSpend)}${i.costPerPickup !== null ? `, ${money(i.costPerPickup)} per picked-up renter` : ""}` : "none entered"],
    ["Miles tracked", i.trips > 0 ? `${Math.round(i.miles).toLocaleString("en-US")} miles in ${i.trips} trips` : "no trips recorded"],
  ];
  const subject = `Zivo week of ${i.weekLabel}: ${money(i.net)} net cash${attention.length ? `, ${attention.length} thing${attention.length === 1 ? "" : "s"} need you` : ", all quiet"}`;

  const text = [
    `Zivo weekly summary: ${i.weekLabel}`,
    "",
    attention.length ? "NEEDS YOU" : "Nothing needs you this week.",
    ...attention.map((a) => `- ${a}`),
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `Full numbers: ${i.links.business}`,
    `Team and inbox: ${i.links.workQueue}`,
  ].join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#101828">
<h2 style="margin:0 0 4px">Zivo weekly summary</h2>
<p style="margin:0 0 16px;color:#667085">${esc(i.weekLabel)}</p>
<h3 style="margin:0 0 6px">${attention.length ? "Needs you" : "All quiet"}</h3>
${attention.length ? `<ul style="margin:0 0 16px;padding-left:20px">${attention.map((a) => `<li style="margin-bottom:4px">${esc(a)}</li>`).join("")}</ul>` : `<p style="margin:0 0 16px">Nothing needs you this week.</p>`}
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:6px 0;border-top:1px solid #eaecf0;color:#667085">${esc(k)}</td><td style="padding:6px 0;border-top:1px solid #eaecf0;text-align:right">${esc(v)}</td></tr>`).join("")}</table>
<p style="margin:16px 0 0;font-size:14px"><a href="${esc(i.links.business)}">Open the Business page</a> · <a href="${esc(i.links.workQueue)}">Open the Work queue</a></p>
<p style="margin:12px 0 0;font-size:12px;color:#98a2b3">Weeks run Monday to Sunday (UTC). Car profit uses real cash costs only. Counts from the activity log are a minimum.</p>
</div>`;
  return { subject, text, html, attention };
}
