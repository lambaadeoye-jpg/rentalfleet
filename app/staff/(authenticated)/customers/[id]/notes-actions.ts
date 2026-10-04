"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type CustomerNote = {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
};

export async function getCustomerNotes(customerId: string): Promise<CustomerNote[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customer_note")
    .select("id, body, created_at, author:author_user_id(full_name)")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id,
    body: row.body,
    authorName: (row.author as unknown as { full_name: string | null } | null)?.full_name ?? null,
    createdAt: row.created_at,
  }));
}

export async function addCustomerNote(customerId: string, body: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = body.trim();
  if (!trimmed) {
    return { success: false, error: "Note can't be empty." };
  }

  const supabase = await createClient();
  const { data: customer } = await supabase.from("customer").select("tenant_id").eq("id", customerId).maybeSingle();
  if (!customer) return { success: false, error: "Something went wrong. Please try again." };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("customer_note").insert({
    tenant_id: customer.tenant_id,
    customer_id: customerId,
    body: trimmed,
    author_user_id: user?.id ?? null,
  });

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to add notes." };
    }
    return { success: false, error: "Couldn't add that note. Please try again." };
  }

  revalidatePath(`/staff/customers/${customerId}`);
  return { success: true };
}
