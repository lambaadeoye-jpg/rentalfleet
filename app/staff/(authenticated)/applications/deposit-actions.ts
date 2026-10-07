"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDepositReturn, processRefunds, settleErrorMessage, type DepositReturn } from "@/lib/refunds";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result = { success: true; deposit: DepositReturn; sendNote?: string } | { success: false; error: string };

export async function previewDepositReturn(rentalId: string): Promise<Result> {
  if (!UUID_RE.test(rentalId)) return { success: false, error: "Rental not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("settle_rental_end", { p_rental_id: rentalId, p_note: null, p_dry_run: true });
  if (error) return { success: false, error: settleErrorMessage(error.message) };
  const d = parseDepositReturn(Array.isArray(data) ? data[0] : null);
  return d ? { success: true, deposit: d } : { success: false, error: "Couldn't work out the deposit." };
}

export async function confirmDepositReturn(rentalId: string, note: string): Promise<Result> {
  if (!UUID_RE.test(rentalId)) return { success: false, error: "Rental not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("settle_rental_end", { p_rental_id: rentalId, p_note: note.trim().slice(0, 500) || null, p_dry_run: false });
  if (error) return { success: false, error: settleErrorMessage(error.message) };
  const d = parseDepositReturn(Array.isArray(data) ? data[0] : null);
  if (!d) return { success: false, error: "Settled, but couldn't read the result. Check the Refunds page." };
  let sendNote: string | undefined;
  if (d.status === "approved") {
    const admin = createAdminClient();
    if (admin) { const r = await processRefunds(admin); if (r.failed > 0) sendNote = "The card refund failed. See the Refunds page."; }
  }
  revalidatePath("/staff/applications");
  revalidatePath("/staff/refunds");
  return { success: true, deposit: d, sendNote };
}
