import { createClient } from "@/lib/supabase/server";
import { channelRows, rankChannels, spendBySource, type SpendRow } from "@/lib/ad-spend";
import { carProfit, type CarProfit, type CostRow } from "@/lib/car-profit";
import {
  DAY_MS, cashSummary, callSummary, collections, depositsHeld, funnelRows, weeklyUtilization,
  type CallRow, type PaymentRow, type RefundRow, type RentalRow, type Range,
} from "@/lib/analytics";

type Db = Awaited<ReturnType<typeof createClient>>;

/** True only for the owner/admin. The proxy already keeps other roles out; this is the second lock. */
export async function isAdmin(supabase: Db): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("membership").select("role:role_id(name)").eq("user_id", user.id);
  return (data ?? []).some((m: any) => m.role?.name === "admin");
}

/** Per-car profit for the range. If the cost table isn't there yet, revenue still shows and `costsReady` is false. */
export async function loadCarProfit(supabase: Db, range: Range): Promise<{ rows: CarProfit[]; costs: CostRow[]; costsReady: boolean; errors: number }> {
  const [veh, cst, seg, pay, ref, wo, tol] = await Promise.all([
    supabase.from("vehicle").select("id, year, make, model, plate, status").not("status", "in", "(sold,decommissioned)").limit(500),
    supabase.from("vehicle_cost").select("vehicle_id, purchase_price, purchased_on, monthly_loan, monthly_insurance, monthly_other, management_fee_monthly, partner_share_pct").limit(500),
    supabase.from("rental_segment").select("rental_id, vehicle_id, starts_at").limit(10000),
    supabase.from("payment").select("rental_id, amount, kind, status, paid_at").eq("status", "paid").gte("paid_at", range.from.toISOString()).lt("paid_at", range.to.toISOString()).limit(5000),
    supabase.from("refund").select("rental_id, status, rent_refund_cents, completed_at").eq("status", "succeeded").gte("completed_at", range.from.toISOString()).lt("completed_at", range.to.toISOString()).limit(5000),
    supabase.from("maintenance_work_order").select("vehicle_id, status, cost, downtime_end, approved_at").eq("status", "completed").limit(5000),
    supabase.from("toll_transaction").select("vehicle_id, status, amount, created_at").eq("status", "waived").gte("created_at", range.from.toISOString()).lt("created_at", range.to.toISOString()).limit(5000),
  ]);
  const costsReady = !cst.error;
  const errors = [veh.error, seg.error, pay.error, ref.error, wo.error, tol.error].filter(Boolean).length;
  const costs = (cst.data ?? []) as CostRow[];
  const rows = carProfit(
    (veh.data ?? []) as any[], costs, (seg.data ?? []) as any[], (pay.data ?? []) as any[], (ref.data ?? []) as any[],
    (wo.data ?? []) as any[], (tol.data ?? []) as any[], range.from, range.to,
  );
  return { rows, costs, costsReady, errors };
}

/** Ad spend for the funnel window and the cost-per-source ranking. `ready` is false until the ad_spend table exists. */
export async function loadAdSpend(supabase: Db, funnel: ReturnType<typeof funnelRows>, funnelDays: number, now: Date = new Date()) {
  const { data, error } = await supabase.from("ad_spend").select("id, month, source, amount").order("month", { ascending: false }).limit(300);
  const rows = ((data ?? []) as { id: string; month: string; source: string; amount: unknown }[]);
  const from = new Date(now.getTime() - funnelDays * DAY_MS);
  const spend = spendBySource(rows as SpendRow[], from, now);
  const ranked = rankChannels(channelRows(funnel, spend));
  const sources = [...new Set([...funnel.map((f) => f.label), ...rows.map((r) => r.source), "meta_ads", "google_ads", "facebook_marketplace"])].filter((s) => !s.includes(" · ")).sort();
  const entries = rows.map((r) => ({ id: r.id, month: r.month, source: r.source, amount: Number(r.amount) }));
  return { ready: !error, ranked, sources, entries, anySpend: [...spend.values()].some((v) => v > 0) };
}

export async function loadBusiness(supabase: Db, range: Range, now: Date = new Date()) {
  const sinceDays = Math.min(366, Math.max(1, Math.ceil((now.getTime() - range.from.getTime()) / DAY_MS)));
  const [pay, ref, ren, veh, fun, calls] = await Promise.all([
    supabase.from("payment").select("amount, kind, status, paid_at").limit(5000),
    supabase.from("refund").select("status, rent_refund_cents, deposit_refund_cents, completed_at").limit(5000),
    supabase.from("rental").select("status, pickup_confirmed_at, actual_return_at, expected_return_at").not("pickup_confirmed_at", "is", null).limit(5000),
    supabase.from("vehicle").select("id", { count: "exact", head: true }).not("status", "in", "(sold,decommissioned)"),
    supabase.rpc("funnel_by_source", { p_days: sinceDays, p_group: "source" }),
    supabase.from("call_review").select("assistant_key, metrics").gte("started_at", range.from.toISOString()).lt("started_at", range.to.toISOString()).limit(5000),
  ]);

  const errors = [pay.error, ref.error, ren.error, veh.error, fun.error, calls.error].filter(Boolean).length;
  const payments = (pay.data ?? []) as PaymentRow[];
  const refunds = (ref.data ?? []) as RefundRow[];
  const fleetSize = veh.count ?? 0;

  return {
    errors,
    fleetSize,
    cash: cashSummary(payments, refunds, range.from, range.to),
    prevCash: cashSummary(payments, refunds, range.prevFrom, range.prevTo),
    collections: collections(payments, range.from, range.to),
    depositsHeld: depositsHeld(payments, refunds),
    utilization: weeklyUtilization((ren.data ?? []) as RentalRow[], fleetSize, range.from, range.to, now),
    funnel: funnelRows((fun.data ?? []) as any[]),
    funnelDays: sinceDays,
    calls: callSummary((calls.data ?? []) as CallRow[]),
  };
}
