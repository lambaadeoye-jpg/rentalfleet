import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAutomationAuthorized } from "@/lib/automation-auth";
import { applicationAging, inboxResponse, type AppRow, type InboxEvent } from "@/lib/analytics";
import { channelRows, rankChannels, spendBySource, type SpendRow } from "@/lib/ad-spend";
import { carProfitTotals } from "@/lib/car-profit";
import { originFor } from "@/lib/hosts";
import { buildWeeklySummary, lastFullWeek } from "@/lib/weekly-summary";
import { loadBusiness, loadCarProfit, loadTracking } from "@/app/staff/(authenticated)/business/data";

// Called once a week (Monday morning) by an n8n Schedule trigger, never by a browser.
// Builds the owner's summary for the last full Monday-to-Sunday week and returns { subject, text, html }.
// n8n does the emailing. This route only reads data and sends nothing, so calling it twice is harmless.
// It reads with the service role, so it assumes one business (the current setup); add a tenant filter before a second one exists.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAutomationAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !url) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  const db: any = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const now = new Date();
    const week = lastFullWeek(now);
    const [biz, cars, ads, flags, apps, msgs] = await Promise.all([
      loadBusiness(db, week, now),
      loadCarProfit(db, week),
      db.from("ad_spend").select("month, source, amount").limit(500),
      db.from("lead_funnel_flags").select("source, applied, approved, picked_up").gte("created_at", week.from.toISOString()).lt("created_at", week.to.toISOString()).limit(10000),
      db.from("application").select("status, submitted_at, decision_at").in("status", ["submitted", "screening", "review"]).limit(2000),
      db.from("communication_event").select("customer_id, lead_id, direction, event_type, created_at, handled_at, payload").eq("event_type", "message").gte("created_at", new Date(week.from.getTime() - 7 * 86400000).toISOString()).limit(5000),
    ]);
    const tracking = await loadTracking(db, week, biz.fleetSize, now);

    // Leads this week by channel, for lead totals and cost per picked-up renter.
    const bySource = new Map<string, { label: string; leads: number; applied: number; approved: number; pickedUp: number }>();
    for (const r of (flags.data ?? []) as { source: string; applied: boolean; approved: boolean; picked_up: boolean }[]) {
      const b = bySource.get(r.source) ?? { label: r.source, leads: 0, applied: 0, approved: 0, pickedUp: 0 };
      b.leads++;
      if (r.applied) b.applied++;
      if (r.approved) b.approved++;
      if (r.picked_up) b.pickedUp++;
      bySource.set(r.source, b);
    }
    const funnel = [...bySource.values()];
    const spend = spendBySource((ads.data ?? []) as SpendRow[], week.from, week.to);
    const ranked = rankChannels(channelRows(funnel, spend));
    const adSpend = [...spend.values()].reduce((a, v) => a + v, 0);
    const paidPickups = ranked.filter((r) => r.row.spend > 0).reduce((a, r) => a + r.row.pickedUp, 0);

    const aging = applicationAging((apps.data ?? []) as AppRow[], now);
    const inbox = inboxResponse((msgs.data ?? []) as InboxEvent[], week.from, now, now);
    const totals = carProfitTotals(cars.rows);
    const util = biz.utilization.length ? Math.round(biz.utilization.reduce((a, w) => a + w.pct, 0) / biz.utilization.length) : null;

    const summary = buildWeeklySummary({
      weekLabel: week.label,
      links: { business: `${originFor("admin")}/staff/business`, workQueue: `${originFor("admin")}/staff/work-queue` },
      rent: biz.cash.rent, prevRent: biz.prevCash.rent, refunds: biz.cash.refunds, net: biz.cash.net, prevNet: biz.prevCash.net,
      atRisk: biz.collections.atRisk, atRiskCount: biz.collections.atRiskCount, upcoming: biz.collections.upcoming,
      utilizationPct: biz.fleetSize > 0 ? util : null,
      leads: funnel.reduce((a, f) => a + f.leads, 0), applied: funnel.reduce((a, f) => a + f.applied, 0), pickedUp: funnel.reduce((a, f) => a + f.pickedUp, 0),
      waitingApps: aging.waiting, oldestWaitingHours: aging.oldestHours, unansweredMessages: inbox.unanswered,
      carsLosing: cars.rows.filter((r) => r.before < 0).map((r) => r.label),
      carProfitBefore: totals.before, carProfitAfter: totals.after, carsWithoutCosts: cars.costsReady ? cars.rows.filter((r) => !r.hasCosts).length : 0,
      adSpend, costPerPickup: adSpend > 0 && paidPickups > 0 ? Math.round((adSpend / paidPickups) * 100) / 100 : null,
      adMore: ranked.filter((r) => r.verdict === "more").map((r) => r.row.label), adCut: ranked.filter((r) => r.verdict === "cut").map((r) => r.row.label),
      miles: tracking.weeks.reduce((a, w) => a + w.miles, 0), trips: tracking.weeks.reduce((a, w) => a + w.trips, 0), trackers: tracking.coverage,
    });
    const loadErrors = biz.errors + cars.errors + tracking.errors;
    return NextResponse.json({ success: true, week: week.label, loadErrors, attentionCount: summary.attention.length, subject: summary.subject, text: summary.text, html: summary.html });
  } catch (e) {
    console.error("[weekly-summary] failed:", (e as Error).message);
    return NextResponse.json({ error: "Could not build the summary" }, { status: 500 });
  }
}
