import { createClient } from "@/lib/supabase/server";
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
