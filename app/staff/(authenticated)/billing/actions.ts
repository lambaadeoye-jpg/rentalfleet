"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { billingErrorLabel } from "@/lib/billing";
import { generateUploadToken } from "@/lib/upload-token";
import { cardUpdateUrl, CARD_LINK_HOURS } from "@/lib/card-update";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BillingRow = {
  scheduleId: string; rentalId: string; customerId: string | null; customerName: string; weeklyAmount: number; nextDueAt: string | null;
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
      scheduleId: s.id, rentalId: s.rental_id, customerId: s.rental?.customer_id ?? null,
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

/** Staff: make a private update-card link for a renter (valid 72 hours; replaces any earlier open link). */
export async function createCardLink(customerId: string): Promise<{ success: true; url: string } | { success: false; error: string }> {
  if (!UUID_RE.test(customerId)) return { success: false, error: "Something went wrong." };
  const supabase = await createClient();
  const { token, hash } = generateUploadToken();
  const { error } = await supabase.rpc("create_card_update_request", { p_customer_id: customerId, p_token_hash: hash, p_hours: CARD_LINK_HOURS });
  if (error) {
    const m = (error.message ?? "").toLowerCase();
    if (m.includes("permission")) return { success: false, error: "You don't have permission to do this." };
    if (m.includes("payments_disabled")) return { success: false, error: "Card payments are switched off. Turn them on first." };
    return { success: false, error: "Couldn't make the link. Please try again." };
  }
  return { success: true, url: cardUpdateUrl(token) };
}
