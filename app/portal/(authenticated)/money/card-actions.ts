"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateUploadToken } from "@/lib/upload-token";
import { cardUpdateUrl, CARD_LINK_HOURS } from "@/lib/card-update";

/** A signed-in renter asks for a link to update their own card. The renter is identified from their login, never from input. */
export async function createMyCardLink(): Promise<{ success: true; url: string } | { success: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Please sign in again." };
  const { data: customer } = await supabase.from("customer").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (!customer) return { success: false, error: "We couldn’t find your account. Please contact us." };

  const admin = createAdminClient();
  if (!admin) return { success: false, error: "Card updates aren’t available right now. Please contact us." };
  const { token, hash } = generateUploadToken();
  const { error } = await admin.rpc("create_card_update_request", { p_customer_id: customer.id, p_token_hash: hash, p_hours: CARD_LINK_HOURS });
  if (error) {
    if ((error.message ?? "").includes("payments_disabled")) return { success: false, error: "Card updates aren’t available right now. Please contact us." };
    return { success: false, error: "We couldn’t start that. Please try again." };
  }
  return { success: true, url: cardUpdateUrl(token) };
}
