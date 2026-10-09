"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AGREEMENT_DOCUMENT_TYPE } from "@/lib/agreement";
import { buildSigningLink } from "@/lib/signing-link";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AgreementStatus = {
  hasApprovedVersion: boolean;
  signed: { signerName: string; signedAt: string; url: string | null } | null;
  link: { expiresAt: string } | null;
};

export async function getAgreementStatus(rentalId: string): Promise<AgreementStatus> {
  const supabase = await createClient();
  const [{ data: ver }, { data: signed }, { data: reqs }] = await Promise.all([
    supabase.from("document_version").select("id").eq("document_type", AGREEMENT_DOCUMENT_TYPE).eq("status", "approved").limit(1),
    supabase.from("signed_document").select("signer_name, signed_at, storage_key").eq("rental_id", rentalId).not("sign_request_id", "is", null).maybeSingle(),
    supabase.from("sign_request").select("expires_at, signed_at, revoked_at").eq("rental_id", rentalId).order("created_at", { ascending: false }).limit(1),
  ]);
  let url: string | null = null;
  if (signed?.storage_key) {
    const { data } = await supabase.storage.from("applicant-documents").createSignedUrl(signed.storage_key, 600);
    url = data?.signedUrl ?? null;
  }
  const latest = reqs?.[0];
  const activeLink = latest && !latest.signed_at && !latest.revoked_at && new Date(latest.expires_at).getTime() > Date.now() ? { expiresAt: latest.expires_at } : null;
  return {
    hasApprovedVersion: (ver ?? []).length > 0,
    signed: signed ? { signerName: signed.signer_name ?? "", signedAt: signed.signed_at, url } : null,
    link: activeLink,
  };
}

export async function createSigningLink(rentalId: string): Promise<{ success: boolean; url?: string; error?: string }> {
  if (!UUID_RE.test(rentalId)) return { success: false, error: "Something went wrong. Please try again." };
  const supabase = await createClient();
  const res = await buildSigningLink(supabase, rentalId);
  if (!res.success) return res;
  revalidatePath("/staff/applications");
  revalidatePath("/staff/contracts");
  return res;
}
