import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateUploadToken, uploadLinkUrl } from "@/lib/upload-token";
import { isUploadDocumentType, UPLOAD_DOCUMENT_TYPES } from "@/lib/upload-validation";

// For n8n / voice assistants: create a private document-upload link for a
// customer and get back the URL to text or email them. Same secret header as
// the other automation routes.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const secret = request.headers.get("x-automation-secret");
  if (!secret || secret !== process.env.AUTOMATION_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const customerId = String(body?.customerId ?? "");
  const applicationId = body?.applicationId ? String(body.applicationId) : null;
  if (!UUID_RE.test(customerId) || (applicationId && !UUID_RE.test(applicationId))) {
    return NextResponse.json({ error: "Invalid customerId or applicationId" }, { status: 400 });
  }
  const requested: unknown[] = Array.isArray(body?.documentTypes) && body.documentTypes.length ? body.documentTypes : [...UPLOAD_DOCUMENT_TYPES];
  const types = [...new Set(requested.map(String))].filter(isUploadDocumentType);
  if (types.length === 0) return NextResponse.json({ error: "No valid documentTypes" }, { status: 400 });

  const { token, hash } = generateUploadToken();
  const { error } = await admin.rpc("create_upload_request", {
    p_customer_id: customerId, p_token_hash: hash, p_types: types, p_hours: 72, p_application_id: applicationId,
  });
  if (error) {
    const notFound = /customer_not_found|invalid_application/.test(error.message ?? "");
    return NextResponse.json({ error: notFound ? "Not found" : "Couldn't create link" }, { status: notFound ? 404 : 500 });
  }
  return NextResponse.json({ url: uploadLinkUrl(token), expiresInHours: 72, documentTypes: types });
}
