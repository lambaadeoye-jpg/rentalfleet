"use server";

import { randomUUID } from "crypto";
import { createPublicClient } from "@/lib/supabase/public";
import { headers } from "next/headers";
import { fireN8nWebhook, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";
import { sanitizeAttribution, deriveSource, type Attribution } from "@/lib/attribution";
import { CONTACT_CONSENT_TEXT, CONTACT_CONSENT_VERSION } from "@/lib/contact-consent";
import { isValidEmail, isValidUsPhone } from "@/lib/contact-validation";
import { validateStep1, validateStep2, cleanStep2 } from "@/lib/lead-steps";
import { generateUploadToken, hashUploadToken } from "@/lib/upload-token";

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
  /** Optional, unchecked-by-default permission to text/call. Never required. */
  contactConsent?: boolean;
  attribution?: Attribution;
  /** Fallback source label when attribution says nothing (e.g. "get-started"). */
  sourceFallback?: string;
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

    if (!isValidEmail(email)) {
      return { success: false, error: "Please enter a valid email address." };
    }
    if (!isValidUsPhone(phone)) {
      return { success: false, error: "Please enter a valid 10-digit mobile number." };
    }
    if (firstName.length > 80 || lastName.length > 80) {
      return { success: false, error: "That name looks too long. Please check it." };
    }

    const attribution = sanitizeAttribution(formData.attribution);
    const fallback = formData.sourceFallback === "get-started" ? "get-started" : "homepage";
    const source = deriveSource(attribution, fallback);

    // Consent record: wording + version come from the server, never the
    // client, so what's stored is exactly what we showed.
    const consented = formData.contactConsent === true;
    let consentIp: string | null = null;
    let consentUa: string | null = null;
    if (consented) {
      try {
        const h = await headers();
        consentIp = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim().slice(0, 64) || null;
        consentUa = (h.get("user-agent") ?? "").slice(0, 300) || null;
      } catch {
        // Header access failing must not lose the lead.
      }
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
      source,
      stage: "new",
      utm_source: attribution.utmSource ?? null,
      utm_medium: attribution.utmMedium ?? null,
      utm_campaign: attribution.utmCampaign ?? null,
      utm_content: attribution.utmContent ?? null,
      utm_term: attribution.utmTerm ?? null,
      click_id: attribution.clickId ?? null,
      landing_path: attribution.landingPath ?? null,
      referrer: attribution.referrer ?? null,
      first_cta: attribution.cta ?? null,
      contact_consent_at: consented ? new Date().toISOString() : null,
      contact_consent_text: consented ? CONTACT_CONSENT_TEXT : null,
      contact_consent_version: consented ? CONTACT_CONSENT_VERSION : null,
      consent_ip: consentIp,
      consent_user_agent: consentUa,
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
      source,
      utmSource: attribution.utmSource ?? null,
      utmMedium: attribution.utmMedium ?? null,
      utmCampaign: attribution.utmCampaign ?? null,
      landingPath: attribution.landingPath ?? null,
      contactConsent: consented,
      referralCode: formData.referralCode?.trim() || null,
    });

    // The AI call is no longer fired from here. The outreach queue (migration
    // 0072) schedules an "ai_call" step ~3 minutes after submission and the
    // dispatcher (/api/automation/outreach/run) fires newLeadCallTrigger only
    // for leads with recorded consent, outside quiet hours, and with no reply
    // or progress. Firing it here too would double-call.

    return { success: true };
  } catch {
    // Catches anything unexpected (network failure, serialization issue,
    // etc.) that isn't one of the typed Postgrest error paths above --
    // guarantees the caller always gets a real result, never a hang.
    return { success: false, error: "Something went wrong. Please try again in a moment." };
  }
}

// ---------------------------------------------------------------------------
// Two-step lead form (migration 0084)
// ---------------------------------------------------------------------------

export type Step1Result =
  | { success: true; leadId: string; token: string }
  | { success: false; error: string };

/**
 * Step 1: saves the lead the moment they give name, mobile, email, platform, need-by date and (optionally) consent.
 * A lead who stops here is still a real lead, so outreach starts now. The last name is saved empty and filled in at
 * step 2. Returns a one-time token; only its hash is stored. Same discipline as submitLead: never throws, no
 * read-back (anon has no SELECT), id generated here.
 */
export async function submitLeadStep1(formData: {
  firstName: string;
  phone: string;
  email: string;
  otherPlatformDetail: string;
  pickupDate: string | null;
  gigPlatformIds: string[];
  referralCode?: string;
  contactConsent?: boolean;
  attribution?: Attribution;
}): Promise<Step1Result> {
  try {
    const invalid = validateStep1(formData);
    if (invalid) return { success: false, error: invalid };
    const firstName = formData.firstName.trim();
    const phone = formData.phone.trim();
    const email = formData.email.trim();

    const attribution = sanitizeAttribution(formData.attribution);
    const source = deriveSource(attribution, "homepage");

    const consented = formData.contactConsent === true;
    let consentIp: string | null = null;
    let consentUa: string | null = null;
    if (consented) {
      try {
        const h = await headers();
        consentIp = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim().slice(0, 64) || null;
        consentUa = (h.get("user-agent") ?? "").slice(0, 300) || null;
      } catch {
        // Header access failing must not lose the lead.
      }
    }

    const supabase = createPublicClient();
    const { data: tenant, error: tenantError } = await supabase
      .from("tenant").select("id").eq("status", "active").limit(1).maybeSingle();
    if (tenantError || !tenant) {
      return { success: false, error: "Something went wrong on our end. Please try again shortly." };
    }

    // Watch-list check on what we have (name is first name only until step 2, which re-checks).
    let redFlagMatched = false;
    let redFlagMatchType: string | null = null;
    const { data: redFlagResult } = await supabase.rpc("check_red_flag", {
      p_tenant_id: tenant.id, p_phone: phone, p_email: email, p_first_name: firstName, p_last_name: "",
    });
    if (redFlagResult && redFlagResult.length > 0) {
      redFlagMatched = redFlagResult[0].matched;
      redFlagMatchType = redFlagResult[0].match_type;
    }

    const leadId = randomUUID();
    const { token, hash } = generateUploadToken();

    const { error: insertError } = await supabase.from("lead").insert({
      id: leadId,
      tenant_id: tenant.id,
      first_name: firstName,
      last_name: "",
      phone,
      email,
      pickup_date: formData.pickupDate || null,
      red_flag_matched: redFlagMatched,
      red_flag_match_type: redFlagMatchType,
      source,
      stage: "new",
      details_token_hash: hash,
      utm_source: attribution.utmSource ?? null,
      utm_medium: attribution.utmMedium ?? null,
      utm_campaign: attribution.utmCampaign ?? null,
      utm_content: attribution.utmContent ?? null,
      utm_term: attribution.utmTerm ?? null,
      click_id: attribution.clickId ?? null,
      landing_path: attribution.landingPath ?? null,
      referrer: attribution.referrer ?? null,
      first_cta: attribution.cta ?? null,
      contact_consent_at: consented ? new Date().toISOString() : null,
      contact_consent_text: consented ? CONTACT_CONSENT_TEXT : null,
      contact_consent_version: consented ? CONTACT_CONSENT_VERSION : null,
      consent_ip: consentIp,
      consent_user_agent: consentUa,
      driving_for: formData.otherPlatformDetail.trim() || null,
    });
    if (insertError) {
      return { success: false, error: "We couldn't submit your request. Please try again." };
    }

    if (formData.gigPlatformIds.length > 0) {
      // Best-effort: the lead itself already landed even if this fails.
      await supabase.from("lead_gig_platform").insert(
        formData.gigPlatformIds.map((gig_platform_id) => ({ tenant_id: tenant.id, lead_id: leadId, gig_platform_id })),
      );
    }

    if (formData.referralCode?.trim()) {
      try {
        await supabase.rpc("link_referral", { p_referral_code: formData.referralCode.trim(), p_lead_id: leadId });
      } catch {
        // A bad code must never fail the lead.
      }
    }

    void fireN8nWebhook(N8N_WEBHOOK_PATHS.newLead, {
      leadId,
      firstName,
      lastName: "",
      phone,
      email,
      platformIds: formData.gigPlatformIds,
      hasDriversLicense: null,
      drivingStatus: null,
      urgency: null,
      redFlagMatched,
      redFlagMatchType,
      source,
      utmSource: attribution.utmSource ?? null,
      utmMedium: attribution.utmMedium ?? null,
      utmCampaign: attribution.utmCampaign ?? null,
      landingPath: attribution.landingPath ?? null,
      contactConsent: consented,
      referralCode: formData.referralCode?.trim() || null,
      formStep: 1,
    });

    return { success: true, leadId, token };
  } catch {
    return { success: false, error: "Something went wrong. Please try again in a moment." };
  }
}

export type Step2Result = { success: true } | { success: false; error: string; requestSaved: boolean };

/** Step 2: last name and the rest. Works only with the step-1 token, once, within 7 days. */
export async function completeLeadStep2(input: {
  leadId: string;
  token: string;
  lastName: string;
  preferredCategoryId: string | null;
  rentalOption?: string | null;
  urgency?: string | null;
  additionalInfo?: string | null;
  heardAbout?: string | null;
}): Promise<Step2Result> {
  try {
    const invalid = validateStep2(input);
    if (invalid) return { success: false, error: invalid, requestSaved: true };
    if (!input.leadId || !input.token) {
      return { success: false, error: "We couldn't save those details, but your request is saved.", requestSaved: true };
    }
    const c = cleanStep2(input);
    const supabase = createPublicClient();
    const { data, error } = await supabase.rpc("complete_lead_details", {
      p_lead_id: input.leadId,
      p_token_hash: hashUploadToken(input.token),
      p_last_name: c.lastName,
      p_category_id: input.preferredCategoryId || null,
      p_rental_option: c.rentalOption,
      p_urgency: c.urgency,
      p_other_platform: null,
      p_notes: c.additionalInfo,
      p_heard_about: c.heardAbout,
    });
    if (error || data !== true) {
      return { success: false, error: "We couldn't save those last details, but your request is saved and we'll follow up.", requestSaved: true };
    }
    return { success: true };
  } catch {
    return { success: false, error: "We couldn't save those last details, but your request is saved and we'll follow up.", requestSaved: true };
  }
}
