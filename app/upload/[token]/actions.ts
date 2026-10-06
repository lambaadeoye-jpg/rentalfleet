"use server";

import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashUploadToken } from "@/lib/upload-token";
import {
  UPLOAD_TOKEN_RE, checkUpload, isUploadDocumentType, extensionFor, mimeFor, uploadErrorMessage, MAX_UPLOAD_BYTES,
} from "@/lib/upload-validation";

// Public (no sign-in) upload. The long random token in the link is the only
// credential, so everything is checked here AND in the database function:
// token format, link still valid, document type was asked for, real file
// type from its bytes, size, and a per-link upload cap.
export async function uploadViaToken(
  token: string,
  documentType: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  if (!UPLOAD_TOKEN_RE.test(token) || !isUploadDocumentType(documentType)) {
    return { success: false, error: uploadErrorMessage("link_invalid") };
  }
  const file = formData.get("file");
  if (!(file instanceof File)) return { success: false, error: "Choose a file first." };
  if (file.size > MAX_UPLOAD_BYTES) return { success: false, error: "That file is too large (max 5 MB). Try a smaller photo." };

  const admin = createAdminClient();
  if (!admin) return { success: false, error: "Upload failed. Please try again." };

  const hash = hashUploadToken(token);
  const { data: reqRows, error: reqError } = await admin.rpc("get_upload_request", { p_token_hash: hash });
  if (reqError) return { success: false, error: "Upload failed. Please try again." };
  const req = Array.isArray(reqRows) ? reqRows[0] : null;
  if (!req) return { success: false, error: uploadErrorMessage("link_invalid") };
  if (!(req.document_types as string[]).includes(documentType)) return { success: false, error: uploadErrorMessage("type_not_allowed") };

  const buf = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(buf.byteLength, buf.slice(0, 16));
  if (!check.ok) return { success: false, error: check.error };

  // Filename is generated, never taken from the user.
  const path = `${req.tenant_id}/${req.customer_id}/${documentType}/${Date.now()}_${randomBytes(6).toString("hex")}.${extensionFor(check.type)}`;
  const { error: uploadError } = await admin.storage
    .from("applicant-documents")
    .upload(path, buf, { contentType: mimeFor(check.type), upsert: false });
  if (uploadError) return { success: false, error: "Upload failed. Please try again." };

  const { error: recordError } = await admin.rpc("record_upload_via_token", {
    p_token_hash: hash,
    p_type: documentType,
    p_storage_key: path,
  });
  if (recordError) {
    await admin.storage.from("applicant-documents").remove([path]);
    return { success: false, error: uploadErrorMessage(recordError.message) };
  }
  return { success: true };
}
