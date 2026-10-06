"use server";

import { headers } from "next/headers";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashUploadToken } from "@/lib/upload-token";
import { UPLOAD_TOKEN_RE } from "@/lib/upload-validation";
import { nameMatches, missingInitials, type RenderedAgreement } from "@/lib/agreement";
import { agreementHash } from "@/lib/agreement-hash";
import { buildSignedAgreementPdf } from "@/lib/agreement-pdf";

const ERRORS: Record<string, string> = {
  link_invalid: "This link has expired or is no longer active. Ask us for a new one.",
  already_signed: "This agreement has already been signed.",
  consent_required: "Please confirm you agree to sign electronically.",
  name_mismatch: "Type your full legal name exactly as it appears on your application.",
  initials_required: "Please initial each highlighted clause (2 to 4 letters).",
};
function errorFor(message: string | undefined): string {
  for (const [code, text] of Object.entries(ERRORS)) if ((message ?? "").includes(code)) return text;
  return "We couldn't record your signature. Please try again.";
}

export async function signAgreement(
  token: string,
  typedName: string,
  initials: Record<string, string>,
  consent: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!UPLOAD_TOKEN_RE.test(token)) return { success: false, error: ERRORS.link_invalid };
  const admin = createAdminClient();
  if (!admin) return { success: false, error: "We couldn't record your signature. Please try again." };

  const hash = hashUploadToken(token);
  const { data: rows, error: getError } = await admin.rpc("get_sign_request", { p_token_hash: hash });
  if (getError) return { success: false, error: "We couldn't record your signature. Please try again." };
  const req = Array.isArray(rows) ? rows[0] : null;
  if (!req) return { success: false, error: ERRORS.link_invalid };
  if (req.signed_at) return { success: false, error: ERRORS.already_signed };

  const rendered = req.rendered as RenderedAgreement;
  const name = typedName.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!consent) return { success: false, error: ERRORS.consent_required };
  if (!nameMatches(name, req.first_name ?? "", req.last_name ?? "")) return { success: false, error: ERRORS.name_mismatch };
  const cleanInitials: Record<string, string> = {};
  for (const [k, v] of Object.entries(initials ?? {})) if (/^\d{1,3}$/.test(k)) cleanInitials[k] = String(v ?? "").trim().slice(0, 4);
  if (missingInitials(rendered.clauses, cleanInitials).length) return { success: false, error: ERRORS.initials_required };
  // The stored text must still match the fingerprint taken when the link was made.
  if (agreementHash(rendered) !== req.content_hash) return { success: false, error: "This agreement changed. Ask us for a new link." };

  const h = await headers();
  const ip = (h.get("x-nf-client-connection-ip") || (h.get("x-forwarded-for") ?? "").split(",")[0] || "unknown").trim().slice(0, 64);
  const ua = (h.get("user-agent") ?? "unknown").slice(0, 300);
  const signedAt = new Date();

  const { data: ver } = await admin.from("document_version").select("version, title").eq("id", req.document_version_id).maybeSingle();
  const versionLabel = `v${ver?.version ?? "?"}${ver?.title ? ` - ${ver.title}` : ""}`;

  const keptInitials: Record<string, string> = {};
  for (const c of rendered.clauses) if (c.initial) keptInitials[String(c.number)] = cleanInitials[String(c.number)].toUpperCase();

  let pdf: Uint8Array;
  try {
    pdf = await buildSignedAgreementPdf(rendered, { signerName: name, signedAtIso: signedAt.toISOString(), ip, versionLabel, contentHash: req.content_hash, initials: keptInitials });
  } catch {
    return { success: false, error: "We couldn't record your signature. Please try again." };
  }

  const path = `${req.tenant_id}/${req.customer_id}/rental_agreement/${Date.now()}_${randomBytes(6).toString("hex")}.pdf`;
  const { error: upError } = await admin.storage.from("applicant-documents").upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (upError) return { success: false, error: "We couldn't record your signature. Please try again." };

  const { error: signError } = await admin.rpc("complete_signing", {
    p_token_hash: hash, p_typed_name: name, p_initials: cleanInitials, p_esign_consent: true, p_ip: ip, p_ua: ua, p_storage_key: path,
  });
  if (signError) {
    await admin.storage.from("applicant-documents").remove([path]);
    return { success: false, error: errorFor(signError.message) };
  }
  return { success: true };
}
