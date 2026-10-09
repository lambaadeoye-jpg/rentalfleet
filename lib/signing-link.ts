import type { SupabaseClient } from "@supabase/supabase-js";
import { generateUploadToken } from "@/lib/upload-token";
import { agreementHash } from "@/lib/agreement-hash";
import { AGREEMENT_DOCUMENT_TYPE, buildRentalValues, renderAgreement, type AgreementTemplate, type RentalFacts } from "@/lib/agreement";

// Builds the rental agreement for one rental and creates the signing link. Shared by the staff screen
// (their own client, row-level security applies) and the renter portal (service client, after the
// caller has verified the renter owns the rental).

const MISSING_LABELS: Record<string, string> = {
  renter_name: "renter’s name", vehicle: "an assigned vehicle", term: "the rent (set the rate or daily quote)", rent_line: "the rent",
  deposit: "the deposit amount", return_location: "a pickup location", late_window_hours: "approved cancellation rules",
  noshow_grace_hours: "approved cancellation rules", rebook_days: "approved cancellation rules", toll_window_days: "approved cancellation rules",
  free_cancellations: "approved cancellation rules", early_fee: "approved cancellation rules", late_fee: "approved cancellation rules",
  travel_area: "the fixed values on the agreement page", cleaning_cap: "the fixed values on the agreement page",
  admin_fee: "the fixed values on the agreement page", late_rent_fee: "the fixed values on the agreement page",
  late_rent_cutoff: "the fixed values on the agreement page", late_return_fee: "the fixed values on the agreement page", county: "the fixed values on the agreement page",
};

export function signLinkUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://rentzivo.com").replace(/\/$/, "");
  return `${base}/sign/${token}`;
}

export async function buildSigningLink(db: SupabaseClient, rentalId: string): Promise<{ success: boolean; url?: string; error?: string }> {
  const { data: rental } = await db
    .from("rental")
    .select("id, status, tenant_id, booking_id, agreed_weekly_rate_usd, deposit_required_usd, governing_policy_snapshot, customer:customer_id(first_name, last_name), rental_segment(vehicle:vehicle_id(year, make, model, plate, vin))")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) return { success: false, error: "Rental not found." };
  if (rental.status !== "approved" && rental.status !== "scheduled") return { success: false, error: "The agreement can be sent once the rental is scheduled." };

  const { data: version } = await db
    .from("document_version")
    .select("id, clauses, variables")
    .eq("document_type", AGREEMENT_DOCUMENT_TYPE)
    .eq("status", "approved")
    .order("approved_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!version?.clauses) return { success: false, error: "No approved agreement yet. Approve one under Settings → Rental agreement." };

  const { data: booking } = rental.booking_id
    ? await db.from("booking").select("pickup_at, return_at, pickup_location_id, quoted_amount").eq("id", rental.booking_id).maybeSingle()
    : { data: null };

  let locationId: string | null = (booking as any)?.pickup_location_id ?? null;
  let loc: any = null;
  if (locationId) {
    ({ data: loc } = await db.from("location").select("name, address_line1, city, state").eq("id", locationId).maybeSingle());
  } else {
    const { data: first } = await db.from("location").select("name, address_line1, city, state").eq("active", true).order("created_at").limit(1).maybeSingle();
    loc = first;
  }
  const returnLocation = loc ? [loc.name, [loc.address_line1, loc.city, loc.state].filter(Boolean).join(", ")].filter(Boolean).join(", ") : null;

  // Cancellation figures: the rental’s own snapshot when it has an approved
  // policy, otherwise today’s approved policy.
  let cancellation = ((rental.governing_policy_snapshot as any)?.cancellation ?? null) as RentalFacts["cancellation"];
  if (!cancellation || cancellation.approved !== true) {
    const { data: policy } = await db.from("policy_version").select("rules").eq("tenant_id", rental.tenant_id).eq("policy_type", "pricing_and_mileage").maybeSingle();
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
  const { error } = await db.rpc("create_sign_request", {
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
  return { success: true, url: signLinkUrl(token) };
}
