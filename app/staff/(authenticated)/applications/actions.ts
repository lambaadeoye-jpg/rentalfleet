"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { DECISION_OUTCOMES } from "./constants";
import { fireN8nWebhook, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";
import { logAuditEvent } from "@/lib/audit-log";

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

  // Fetch contact info for the notification separately from the update
  // above -- if THIS fails for any reason, the decision itself (already
  // committed) is never rolled back or affected. Notification is
  // best-effort; the decision is the real, already-saved outcome.
  const { data: application } = await supabase
    .from("application")
    .select("tenant_id, customer_id, customer:customer_id(first_name, last_name, phone, email)")
    .eq("id", applicationId)
    .maybeSingle();

  const customer = application?.customer as
    | { first_name: string | null; last_name: string | null; phone: string | null; email: string | null }
    | undefined;

  void fireN8nWebhook(N8N_WEBHOOK_PATHS.applicationDecision, {
    applicationId,
    decision,
    reason: reason.trim() || null,
    customerFirstName: customer?.first_name ?? null,
    customerLastName: customer?.last_name ?? null,
    customerPhone: customer?.phone ?? null,
    customerEmail: customer?.email ?? null,
  });

  if (application?.tenant_id) {
    void logAuditEvent({
      tenantId: application.tenant_id,
      action: "application_decision",
      entityType: "application",
      entityId: applicationId,
      afterData: { decision, reason: reason.trim() || null },
      source: "staff_portal",
    });
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
