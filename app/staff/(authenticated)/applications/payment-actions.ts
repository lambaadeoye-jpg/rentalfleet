"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createPaymentRequest, payLinkUrl } from "@/lib/payment-request";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PaymentStatus = {
  enabled: boolean;
  paid: { rentUsd: number; depositUsd: number; paidAt: string | null; nameMatches: boolean | null } | null;
  review: string | null;
  link: { expiresAt: string; totalUsd: number } | null;
};

export async function getPaymentStatus(rentalId: string): Promise<PaymentStatus> {
  const supabase = await createClient();
  const [{ data: setting }, { data: reqs }] = await Promise.all([
    supabase.from("tenant_setting").select("value").eq("key", "payments_enabled").maybeSingle(),
    supabase.from("pay_request")
      .select("status, rent_cents, deposit_cents, expires_at, paid_at, card_name_matches, review_note, revoked_at, created_at")
      .eq("rental_id", rentalId).order("created_at", { ascending: false }).limit(5),
  ]);
  const list = reqs ?? [];
  const paid = list.find((r) => r.status === "paid");
  const review = list.find((r) => r.status === "review");
  const open = list.find((r) => r.status === "open" && !r.revoked_at && new Date(r.expires_at).getTime() > Date.now());
  return {
    enabled: setting?.value === "on",
    paid: paid ? { rentUsd: paid.rent_cents / 100, depositUsd: paid.deposit_cents / 100, paidAt: paid.paid_at, nameMatches: paid.card_name_matches } : null,
    review: review ? (review.review_note ?? "Needs review") : null,
    link: open ? { expiresAt: open.expires_at, totalUsd: (open.rent_cents + open.deposit_cents) / 100 } : null,
  };
}

export async function createPaymentLink(rentalId: string): Promise<{ success: boolean; url?: string; totalUsd?: number; error?: string }> {
  if (!UUID_RE.test(rentalId)) return { success: false, error: "Rental not found." };
  const supabase = await createClient();
  const res = await createPaymentRequest(supabase, rentalId);
  if (!res.success) return { success: false, error: res.error };
  revalidatePath("/staff/applications");
  return { success: true, url: payLinkUrl(res.token), totalUsd: res.totalCents / 100 };
}
