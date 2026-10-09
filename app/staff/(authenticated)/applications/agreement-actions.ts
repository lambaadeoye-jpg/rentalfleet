"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generateUploadToken } from "@/lib/upload-token";
import { agreementHash } from "@/lib/agreement-hash";
import {
  AGREEMENT_DOCUMENT_TYPE, buildRentalValues, renderAgreement, type AgreementTemplate, type RentalFacts,
} from "@/lib/agreement";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MISSING_LABELS: Record<string, string> = {
  renter_name: "renter’s name", vehicle: "an assigned vehicle", term: "the rent (set the rate or daily quote)", rent_line: "the rent",
  deposit: "the deposit amount", return_location: "a pickup location", late_window_hours: "approved cancellation rules",
  noshow_grace_hours: "approved cancellation rules", rebook_days: "approved cancellation rules", toll_window_days: "approved cancellation rules",
  free_cancellations: "approved cancellation rules", early_fee: "approved cancellation rules", late_fee: "approved cancellation rules",
  travel_area: "the fixed values on the agreement page", cleaning_cap: "the fixed values on the agreement page",
  admin_fee: "the fixed values on the agreement page", late_rent_fee: "the fixed values on the agreement page",
  grace_days: "the fixed values on the agreement page", county: "the fixed values on the agreement page",
};

function signLinkUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://rentzivo.com").replace(/\/$/, "");
  return `${base}/sign/${token}`;
}

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

  const { data: rental } = await supabase
    .from("rental")
    .select("id, status, tenant_id, booking_id, agreed_weekly_rate_usd, deposit_required_usd, governing_policy_snapshot, customer:customer_id(first_name, last_name), rental_segment(vehicle:vehicle_id(year, make, model, plate, vin))")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) return { success: false, error: "Rental not found." };
  if (rental.status !== "approved" && rental.status !== "scheduled") return { success: false, error: "The agreement can be sent once the rental is scheduled." };

  const { data: version } = await supabase
    .from("document_version")
    .select("id, clauses, variables")
    .eq("document_type", AGREEMENT_DOCUMENT_TYPE)
    .eq("status", "approved")
    .order("approved_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!version?.clauses) return { success: false, error: "No approved agreement yet. Approve one under Settings → Rental agreement." };

  const { data: booking } = rental.booking_id
    ? await supabase.from("booking").select("pickup_at, return_at, pickup_location_id, quoted_amount").eq("id", rental.booking_id).maybeSingle()
    : { data: null };

  let locationId: string | null = (booking as any)?.pickup_location_id ?? null;
  let loc: any = null;
  if (locationId) {
    ({ data: loc } = await supabase.from("location").select("name, address_line1, city, state").eq("id", locationId).maybeSingle());
  } else {
    const { data: first } = await supabase.from("location").select("name, address_line1, city, state").eq("active", true).order("created_at").limit(1).maybeSingle();
    loc = first;
  }
  const returnLocation = loc ? [loc.name, [loc.address_line1, loc.city, loc.state].filter(Boolean).join(", ")].filter(Boolean).join(", ") : null;

  // Cancellation figures: the rental’s own snapshot when it has an approved
  // policy, otherwise today’s approved policy.
  let cancellation = ((rental.governing_policy_snapshot as any)?.cancellation ?? null) as RentalFacts["cancellation"];
  if (!cancellation || cancellation.approved !== true) {
    const { data: policy } = await supabase.from("policy_version").select("rules").eq("tenant_id", rental.tenant_id).eq("policy_type", "pricing_and_mileage").maybeSingle();
    cancellation = ((policy?.rules as any)?.cancellation ?? null) as RentalFacts["cancellation"];
  }

  const customer = rental.customer as any;
  const seg = (rental.rental_segment as any)?.[0];
  const hasLocation = Boolean((booking as any)?.pickup_location_id);
  const facts: RentalFacts = {
    firstName: customer?.first_name ?? "",
    lastName: customer?.last_name ?? "",
    vehicle: seg?.vehicle ?? null,
    pickupAt: hasLocation ? ((booking as any)?.pickup_at ?? null) : null,
    returnAt: hasLocation ? ((booking as any)?.return_at ?? null) : null,
    weeklyRateUsd: rental.agreed_weekly_rate_usd != null ? Number(rental.agreed_weekly_rate_usd) : null,
    quotedTotalUsd: (booking as any)?.quoted_amount != null ? Number((booking as any).quoted_amount) : null,
    depositUsd: rental.deposit_required_usd != null ? Number(rental.deposit_required_usd) : null,
    returnLocation,
    cancellation,
  };

  const values = buildRentalValues(facts, (version.variables as Record<string, string>) ?? {});
  const result = renderAgreement(version.clauses as AgreementTemplate, values);
  if (!result.ok) {
    const needs = [...new Set(result.missing.map((m) => MISSING_LABELS[m] ?? m))];
    return { success: false, error: `The agreement can’t be created yet. Still needed: ${needs.join("; ")}.` };
  }

  const { token, hash } = generateUploadToken();
  const { error } = await supabase.rpc("create_sign_request", {
    p_rental_id: rentalId,
    p_token_hash: hash,
    p_version_id: version.id,
    p_rendered: result.rendered,
    p_content_hash: agreementHash(result.rendered),
    p_hours: 72,
  });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("already_signed")) return { success: false, error: "This rental’s agreement is already signed." };
    if (m.includes("version_not_approved")) return { success: false, error: "No approved agreement yet." };
    return { success: false, error: "Couldn’t create the link. Please try again." };
  }
  revalidatePath("/staff/applications");
  revalidatePath("/staff/contracts");
  return { success: true, url: signLinkUrl(token) };
}
