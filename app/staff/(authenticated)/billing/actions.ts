"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { billingErrorLabel } from "@/lib/billing";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BillingRow = {
  scheduleId: string; rentalId: string; customerName: string; weeklyAmount: number; nextDueAt: string | null;
  weeksPaid: number; paused: boolean; lastStatus: string | null; lastError: string | null; lastAttemptNo: number | null; lastAt: string | null;
  hasCard: boolean; overdue: boolean;
};

export async function getBilling(): Promise<{ rows: BillingRow[]; billingOn: boolean }> {
  const supabase = await createClient();
  const [{ data: schedules }, { data: setting }] = await Promise.all([
    supabase.from("payment_schedule")
      .select("id, rental_id, amount, next_due_at, weeks_paid, billing_paused, rental:rental_id(customer_id, status, customer:customer_id(first_name, last_name))")
      .eq("status", "active").eq("cadence", "weekly").order("next_due_at", { ascending: true }).limit(300),
    supabase.from("tenant_setting").select("value").eq("key", "weekly_billing_enabled").maybeSingle(),
  ]);
  const list = (schedules ?? []).filter((s: any) => ["active", "extended"].includes(s.rental?.status));
  const rentalIds = list.map((s: any) => s.rental_id);
  const customerIds = Array.from(new Set(list.map((s: any) => s.rental?.customer_id).filter(Boolean)));
  const [{ data: attempts }, { data: cards }] = await Promise.all([
    rentalIds.length ? supabase.from("billing_attempt").select("rental_id, status, error, attempt_no, created_at, finished_at").in("rental_id", rentalIds).order("created_at", { ascending: false }).limit(1000) : Promise.resolve({ data: [] as any[] }),
    customerIds.length ? supabase.from("customer_payment_method").select("customer_id").in("customer_id", customerIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const lastByRental = new Map<string, any>();
  for (const a of attempts ?? []) if (!lastByRental.has(a.rental_id)) lastByRental.set(a.rental_id, a);
  const withCard = new Set((cards ?? []).map((c: any) => c.customer_id));
  const now = Date.now();
  const rows: BillingRow[] = list.map((s: any) => {
    const a = lastByRental.get(s.rental_id);
    return {
      scheduleId: s.id, rentalId: s.rental_id,
      customerName: s.rental?.customer ? `${s.rental.customer.first_name} ${s.rental.customer.last_name}` : "Unknown",
      weeklyAmount: Number(s.amount), nextDueAt: s.next_due_at, weeksPaid: s.weeks_paid, paused: !!s.billing_paused,
      lastStatus: a?.status ?? null, lastError: a?.status === "failed" ? billingErrorLabel(a.error) : null,
      lastAttemptNo: a?.attempt_no ?? null, lastAt: a?.finished_at ?? a?.created_at ?? null,
      hasCard: withCard.has(s.rental?.customer_id), overdue: !!s.next_due_at && new Date(s.next_due_at).getTime() < now,
    };
  });
  return { rows, billingOn: (setting?.value ?? "").toLowerCase() === "on" };
}

export async function setPaused(rentalId: string, paused: boolean): Promise<{ success: boolean; error?: string }> {
  if (!UUID_RE.test(rentalId)) return { success: false, error: "Something went wrong." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_billing_paused", { p_rental_id: rentalId, p_paused: paused });
  if (error) {
    if (error.message?.toLowerCase().includes("permission")) return { success: false, error: "You don't have permission to change billing." };
    return { success: false, error: "Couldn't update. Please try again." };
  }
  revalidatePath("/staff/billing");
  return { success: true };
}
