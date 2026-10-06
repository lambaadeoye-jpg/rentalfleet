"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generateUploadToken, uploadLinkUrl } from "@/lib/upload-token";
import { isUploadDocumentType } from "@/lib/upload-validation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_HOURS = 72;

// Create a private upload link for the renter on this application. The
// database checks the staff member belongs to the customer's business; any
// older link for the same renter is revoked.
export async function createUploadLink(
  applicationId: string,
  types: string[]
): Promise<{ success: boolean; url?: string; hours?: number; error?: string }> {
  if (!UUID_RE.test(applicationId)) return { success: false, error: "Something went wrong. Please try again." };
  const wanted = [...new Set(types)].filter(isUploadDocumentType);
  if (wanted.length === 0) return { success: false, error: "Choose at least one document to request." };

  const supabase = await createClient();
  const { data: app } = await supabase.from("application").select("id, customer_id").eq("id", applicationId).maybeSingle();
  if (!app) return { success: false, error: "Application not found." };

  const { token, hash } = generateUploadToken();
  const { error } = await supabase.rpc("create_upload_request", {
    p_customer_id: app.customer_id,
    p_token_hash: hash,
    p_types: wanted,
    p_hours: LINK_HOURS,
    p_application_id: applicationId,
  });
  if (error) return { success: false, error: "Couldn't create the link. Please try again." };
  return { success: true, url: uploadLinkUrl(token), hours: LINK_HOURS };
}

export async function reviewDocument(
  applicationId: string,
  documentId: string,
  status: "accepted" | "rejected",
  note: string
): Promise<{ success: boolean; error?: string }> {
  if (!UUID_RE.test(documentId) || !UUID_RE.test(applicationId)) return { success: false, error: "Something went wrong. Please try again." };
  if (status !== "accepted" && status !== "rejected") return { success: false, error: "Something went wrong. Please try again." };
  if (status === "rejected" && !note.trim()) return { success: false, error: "Add a short note so the renter knows what to fix." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_customer_document", {
    p_doc_id: documentId,
    p_status: status,
    p_note: note.trim() || null,
  });
  if (error) {
    const m = error.message?.toLowerCase() ?? "";
    if (m.includes("permission")) return { success: false, error: "You don't have permission to review documents." };
    if (m.includes("note_required")) return { success: false, error: "Add a short note so the renter knows what to fix." };
    return { success: false, error: "Couldn't save. Please try again." };
  }
  revalidatePath(`/staff/applications/${applicationId}`);
  return { success: true };
}
