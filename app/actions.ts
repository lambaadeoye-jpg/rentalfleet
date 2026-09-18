"use server";

import { randomUUID } from "crypto";
import { createPublicClient } from "@/lib/supabase/public";

export type SubmitLeadResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Submits a lead from the public homepage form. Runs as the anon Postgres
 * role via RLS (migration 0024) -- INSERT only, no read-back. Deliberately
 * does NOT call .select() after .insert(): that would trigger a Postgres
 * RETURNING clause, which requires SELECT privilege anon doesn't have by
 * design (see the note in supabase/migrations/0024_public_marketing_access.sql).
 * We generate the lead's id ourselves instead, so we already have it for the
 * lead_gig_platform inserts without ever asking the database to hand a row back.
 */
export async function submitLead(formData: {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  drivingFor: string; // free text, matches Nashville copy's "What are you driving for?"
  preferredCategoryId: string | null;
  pickupDate: string | null;
  rentalOption: "daily" | "weekly";
  additionalInfo: string;
  gigPlatformIds: string[];
}): Promise<SubmitLeadResult> {
  const firstName = formData.firstName.trim();
  const lastName = formData.lastName.trim();
  const phone = formData.phone.trim();

  // Mirror the DB-level checks (migration 0024) with friendlier messages --
  // the database is still the real enforcement, this is just faster feedback.
  if (!firstName || !lastName || !phone) {
    return { success: false, error: "First name, last name, and mobile phone are required." };
  }

  const supabase = createPublicClient();

  const { data: tenant, error: tenantError } = await supabase
    .from("tenant")
    .select("id")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (tenantError || !tenant) {
    return { success: false, error: "Something went wrong on our end. Please try again shortly." };
  }

  const leadId = randomUUID();

  const { error: insertError } = await supabase.from("lead").insert({
    id: leadId,
    tenant_id: tenant.id,
    first_name: firstName,
    last_name: lastName,
    phone,
    email: formData.email.trim() || null,
    preferred_category_id: formData.preferredCategoryId,
    pickup_date: formData.pickupDate,
    duration_unit: formData.rentalOption,
    source: "homepage",
    stage: "new",
    // "What are you driving for?" is free text per the Nashville copy's lead
    // form; the structured gig_platform checkboxes below are the separate,
    // selectable list (lead_gig_platform), not a replacement for this field.
    // Uses its own column (migration 0025) -- NOT `referral`, which tracks
    // actual referral sources and would collide semantically with this.
    driving_for: formData.drivingFor.trim() || null,
    notes: formData.additionalInfo.trim() || null,
  });

  if (insertError) {
    return { success: false, error: "We couldn't submit your request. Please try again." };
  }

  if (formData.gigPlatformIds.length > 0) {
    const rows = formData.gigPlatformIds.map((gig_platform_id) => ({
      tenant_id: tenant.id,
      lead_id: leadId,
      gig_platform_id,
    }));
    // Best-effort: the lead itself already landed even if this fails.
    await supabase.from("lead_gig_platform").insert(rows);
  }

  return { success: true };
}
