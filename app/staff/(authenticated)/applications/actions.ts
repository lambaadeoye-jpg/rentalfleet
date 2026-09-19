"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { DECISION_OUTCOMES } from "./constants";

export async function decideApplication(
  applicationId: string,
  decision: (typeof DECISION_OUTCOMES)[number],
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  // This UPDATE is permission-gated at the database level (migration 0021's
  // guard_application_decision trigger, requiring the approve_driver
  // permission) -- if a staff member without that permission calls this,
  // Postgres rejects it and the error below is what they'll actually see.
  // The UI enforcing "who can click this" is a nicety; this is what's real.
  const { error } = await supabase
    .from("application")
    .update({
      status: decision,
      decision_at: new Date().toISOString(),
      decision_reason: reason.trim() || null,
    })
    .eq("id", applicationId);

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to decide applications." };
    }
    return { success: false, error: "Couldn't save that decision. Please try again." };
  }

  revalidatePath("/staff/applications");
  revalidatePath(`/staff/applications/${applicationId}`);
  return { success: true };
}

export async function getSignedDocumentUrl(storageKey: string): Promise<string | null> {
  const supabase = await createClient();
  // RLS on storage.objects (migration 0026's staff_tenant_documents_select)
  // is what actually authorizes this -- a staff member from a different
  // tenant would get a null/error here regardless of what URL they guess.
  const { data, error } = await supabase.storage
    .from("applicant-documents")
    .createSignedUrl(storageKey, 60 * 10); // 10 minutes

  if (error || !data) return null;
  return data.signedUrl;
}
