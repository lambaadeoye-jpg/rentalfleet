"use server";

import { randomUUID } from "crypto";
import { createPublicClient } from "@/lib/supabase/public";
import { fireN8nWebhook, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";

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
 *
 * Wrapped in try/catch deliberately: this function must NEVER throw. An
 * unhandled rejection here leaves the calling form stuck on "Submitting..."
 * forever with no error shown, since nothing resets the client's loading
 * state -- that's a real bug this fixes regardless of what specifically
 * causes a given failure.
 */
export async function submitLead(formData: {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  otherPlatformDetail: string; // shown only when "Other" is checked
  preferredCategoryId: string | null;
  pickupDate: string | null;
  rentalOption: "daily" | "weekly";
  additionalInfo: string;
  gigPlatformIds: string[];
  referralCode?: string;
  hasDriversLicense?: boolean;
  drivingStatus?: "already_driving" | "ready_to_start" | "no";
  urgency?: "today" | "this_week" | "within_2_weeks" | "just_checking";
}): Promise<SubmitLeadResult> {
  try {
    const firstName = formData.firstName.trim();
    const lastName = formData.lastName.trim();
    const phone = formData.phone.trim();
    const email = formData.email.trim();

    // Mirror the DB-level checks (migrations 0024, 0052) with friendlier
    // messages -- the database is still the real enforcement, this is
    // just faster feedback.
    if (!firstName || !lastName || !phone || !email) {
      return { success: false, error: "First name, last name, mobile phone, and email are required." };
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

    // Never blocks submission -- flags for staff review only, same
    // "a human decides, automation never auto-rejects" principle as
    // everything else with real consequences in this build. A false
    // positive (shared phone number, common name) is possible, so this
    // is a heads-up for staff, not a gate.
    let redFlagMatched = false;
    let redFlagMatchType: string | null = null;
    const { data: redFlagResult } = await supabase.rpc("check_red_flag", {
      p_tenant_id: tenant.id,
      p_phone: phone,
      p_email: email,
      p_first_name: firstName,
      p_last_name: lastName,
    });
    if (redFlagResult && redFlagResult.length > 0) {
      redFlagMatched = redFlagResult[0].matched;
      redFlagMatchType = redFlagResult[0].match_type;
    }

    const leadId = randomUUID();

    const { error: insertError } = await supabase.from("lead").insert({
      id: leadId,
      tenant_id: tenant.id,
      first_name: firstName,
      last_name: lastName,
      phone,
      email,
      preferred_category_id: formData.preferredCategoryId,
      pickup_date: formData.pickupDate,
      duration_unit: formData.rentalOption,
      has_drivers_license: formData.hasDriversLicense ?? null,
      driving_status: formData.drivingStatus ?? null,
      urgency: formData.urgency ?? null,
      red_flag_matched: redFlagMatched,
      red_flag_match_type: redFlagMatchType,
      source: "homepage",
      stage: "new",
      // "What are you driving for?" is answered by the gig_platform
      // checkboxes (lead_gig_platform, below) -- driving_for only holds the
      // free-text detail when "Other" is selected, so we're not asking the
      // same question two different ways.
      driving_for: formData.otherPlatformDetail.trim() || null,
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

    if (formData.referralCode?.trim()) {
      // Best-effort, same discipline as the gig-platform insert above --
      // a bad/expired code must never fail lead submission itself. The
      // RPC itself is a safe no-op for an invalid code (never throws),
      // this catch is just an extra layer in case of a network issue.
      try {
        await supabase.rpc("link_referral", { p_referral_code: formData.referralCode.trim(), p_lead_id: leadId });
      } catch {
        // Swallowed deliberately -- see comment above.
      }
    }

    // Fire-and-forget -- see lib/n8n-webhook.ts. Never awaited in a way
    // that could delay or fail the response to the person submitting the
    // form; a slow or down n8n instance must never make lead submission
    // itself feel broken.
    void fireN8nWebhook(N8N_WEBHOOK_PATHS.newLead, {
      leadId,
      firstName,
      lastName,
      phone,
      email,
      platformIds: formData.gigPlatformIds,
      hasDriversLicense: formData.hasDriversLicense ?? null,
      drivingStatus: formData.drivingStatus ?? null,
      urgency: formData.urgency ?? null,
      redFlagMatched,
      redFlagMatchType,
    });

    // Separate webhook, separate workflow from the staff alert above --
    // deliberately minimal payload (just the lead's id). The call-trigger
    // workflow re-fetches everything fresh from the lead row itself after
    // its delay rather than trusting this snapshot, since application
    // progress or a red flag match could change in the minutes between
    // submission and the call actually firing.
    void fireN8nWebhook(N8N_WEBHOOK_PATHS.newLeadCallTrigger, { leadId });

    return { success: true };
  } catch {
    // Catches anything unexpected (network failure, serialization issue,
    // etc.) that isn't one of the typed Postgrest error paths above --
    // guarantees the caller always gets a real result, never a hang.
    return { success: false, error: "Something went wrong. Please try again in a moment." };
  }
}
