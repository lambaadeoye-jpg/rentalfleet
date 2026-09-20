"use server";

import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";

// ---------------------------------------------------------------------------
// AUTH: anonymous-first entry. Starting the application no longer requires
// email/link/code up front -- that was real, measured friction sitting at
// the very front door of the flow (contact/verification fields belong at
// the END of a form, not the start -- asking for them first is one of the
// most common causes of early-funnel abandonment). An anonymous Supabase
// session lets someone start filling out the application immediately, with
// phone (already required in the Personal step) as the real fallback
// contact method. Email becomes optional, offered later as a way to resume
// on a different device -- not a gate on starting at all.
// ---------------------------------------------------------------------------
export async function beginAnonymousSession(): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInAnonymously();

  if (error) {
    // Most likely cause: "Allow anonymous sign-ins" isn't enabled yet for
    // this Supabase project (Authentication -> Sign In / Providers). Same
    // category of one-time dashboard setup as the SMTP/redirect URL config.
    return { success: false, error: error.message };
  }
  return { success: true };
}

// Links an email to the CURRENT session (anonymous or otherwise) so the
// applicant can resume from a different device later via magic link.
// Optional, called from within the Workspace -- never blocks starting.
export async function linkEmailForResume(email: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = email.trim();
  if (!trimmed) return { success: false, error: "Enter an email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser(
    { email: trimmed },
    {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback?next=/apply`,
    }
  );

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ---------------------------------------------------------------------------
// AUTH: magic link sign-in for applicants RESUMING on a new device/browser
// where no session persists. Per V2.1 §6: "a secure low-friction
// mechanism... such as magic link or OTP." SMS OTP comes later alongside
// the Vapi/phone build; magic-link email works with zero extra
// infrastructure today. No longer the default first screen -- see
// beginAnonymousSession() above for why.
// ---------------------------------------------------------------------------
export async function sendMagicLink(email: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = email.trim();
  if (!trimmed) return { success: false, error: "Enter your email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      // shouldCreateUser: true is the default, but explicit here since an
      // applicant has no account yet -- this IS their signup.
      shouldCreateUser: true,
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback?next=/apply`,
    },
  });

  if (error) {
    // Surface the real Supabase error rather than a generic message -- this
    // is an Auth API error describing our own configuration (e.g. rate
    // limits, SMTP not set up), not private user data, so it's safe and
    // actually necessary to show while diagnosing the real cause.
    return { success: false, error: error.message };
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// Get-or-create the applicant's customer + application rows. Called once the
// user has a session (post magic-link). Uses the cookie-aware server client
// so it runs AS the authenticated applicant, not a trusted/service context --
// RLS (0020, 0024) genuinely governs what this can do, same as everything
// else in this app.
// ---------------------------------------------------------------------------
export type ApplicationData = {
  customerId: string;
  applicationId: string;
  applicationStatus: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  licenseState: string;
  licenseNumberRef: string;
  licenseExpiry: string;
  gigPlatformIds: string[];
  insuranceProvider: string;
  insurancePolicyReference: string;
};

export async function getOrCreateApplication(): Promise<
  { success: true; data: ApplicationData } | { success: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Not signed in." };

  // A customer row may already exist for this auth user (e.g. they started
  // earlier and are resuming).
  const { data: existingCustomer } = await supabase
    .from("customer")
    .select("id, first_name, last_name, email, phone, status")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  let customerId = existingCustomer?.id as string | undefined;

  if (!customerId) {
    // First time starting an application: create the customer row now, at
    // 'applicant' status -- NOT 'active'. See migration 0026's note: this is
    // what actually lets Lead/Applicant/Customer stay distinct stages
    // instead of collapsing into one the moment a row exists.
    const publicClient = createPublicClient();
    const { data: tenant } = await publicClient
      .from("tenant")
      .select("id")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (!tenant) return { success: false, error: "Something went wrong. Please try again." };

    const { data: newCustomer, error: customerError } = await supabase
      .from("customer")
      .insert({
        tenant_id: tenant.id,
        first_name: "",
        last_name: "",
        email: user.email ?? "",
        auth_user_id: user.id,
        status: "applicant",
      })
      .select("id")
      .single();

    if (customerError || !newCustomer) {
      return { success: false, error: "Couldn't start your application. Please try again." };
    }
    customerId = newCustomer.id;
  }

  // Find an in-progress application, or start one.
  const { data: existingApplication } = await supabase
    .from("application")
    .select("id, status")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let applicationId = existingApplication?.id as string | undefined;
  let applicationStatus = existingApplication?.status ?? "draft";

  if (!applicationId) {
    const { data: customerRow } = await supabase
      .from("customer")
      .select("tenant_id")
      .eq("id", customerId)
      .single();

    const { data: newApplication, error: applicationError } = await supabase
      .from("application")
      .insert({ tenant_id: customerRow?.tenant_id, customer_id: customerId, status: "draft" })
      .select("id, status")
      .single();

    if (applicationError || !newApplication) {
      return { success: false, error: "Couldn't start your application. Please try again." };
    }
    applicationId = newApplication.id;
    applicationStatus = newApplication.status;
  }

  const { data: customer } = await supabase
    .from("customer")
    .select("first_name, last_name, email, phone")
    .eq("id", customerId)
    .single();

  const { data: driver } = await supabase
    .from("authorized_driver")
    .select("license_state, license_number_ref, license_expiry")
    .eq("customer_id", customerId)
    .limit(1)
    .maybeSingle();

  const { data: platforms } = await supabase
    .from("platform_eligibility")
    .select("gig_platform_id")
    .eq("customer_id", customerId);

  const { data: insurance } = await supabase
    .from("insurance_policy")
    .select("provider, policy_reference")
    .eq("customer_id", customerId)
    .eq("policy_type", "renter")
    .limit(1)
    .maybeSingle();

  return {
    success: true,
    data: {
      customerId: customerId!,
      applicationId: applicationId!,
      applicationStatus,
      firstName: customer?.first_name ?? "",
      lastName: customer?.last_name ?? "",
      email: customer?.email ?? "",
      phone: customer?.phone ?? "",
      addressLine1: "",
      city: "",
      state: "",
      postalCode: "",
      licenseState: driver?.license_state ?? "",
      licenseNumberRef: driver?.license_number_ref ?? "",
      licenseExpiry: driver?.license_expiry ?? "",
      gigPlatformIds: (platforms ?? []).map((p) => p.gig_platform_id),
      insuranceProvider: insurance?.provider ?? "",
      insurancePolicyReference: insurance?.policy_reference ?? "",
    },
  };
}

// ---------------------------------------------------------------------------
// STEP 1: Personal
// ---------------------------------------------------------------------------
// Bumps the applicant's most recent application.updated_at whenever a real
// step is saved -- the actual step data lives on OTHER tables (customer,
// authorized_driver, platform_eligibility, insurance_policy), none of
// which touch application itself, so without this there'd be no accurate
// signal of "last real activity" for the abandonment-recovery workflow to
// check. Best-effort and silent: a failure here must never block the
// step save itself, which has already succeeded by the time this runs.
async function touchApplication(customerId: string): Promise<void> {
  const supabase = await createClient();
  const { data: application } = await supabase
    .from("application")
    .select("id")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (application) {
    await supabase.from("application").update({ updated_at: new Date().toISOString() }).eq("id", application.id);
  }
}

export async function savePersonalStep(
  customerId: string,
  fields: { firstName: string; lastName: string; phone: string }
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("customer")
    .update({
      first_name: fields.firstName.trim(),
      last_name: fields.lastName.trim(),
      phone: fields.phone.trim(),
    })
    .eq("id", customerId);

  if (error) return { success: false, error: "Couldn't save. Please try again." };
  await touchApplication(customerId);
  return { success: true };
}

// ---------------------------------------------------------------------------
// STEP 2: License (+ document upload)
// ---------------------------------------------------------------------------
export async function saveLicenseStep(
  customerId: string,
  fields: { licenseState: string; licenseNumberRef: string; licenseExpiry: string }
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("authorized_driver")
    .select("id")
    .eq("customer_id", customerId)
    .limit(1)
    .maybeSingle();

  const { data: customer } = await supabase
    .from("customer")
    .select("tenant_id, first_name, last_name")
    .eq("id", customerId)
    .single();

  if (existing) {
    const { error } = await supabase
      .from("authorized_driver")
      .update({
        license_state: fields.licenseState,
        license_number_ref: fields.licenseNumberRef,
        license_expiry: fields.licenseExpiry || null,
      })
      .eq("id", existing.id);
    if (error) return { success: false, error: "Couldn't save. Please try again." };
  } else {
    const { error } = await supabase.from("authorized_driver").insert({
      tenant_id: customer?.tenant_id,
      customer_id: customerId,
      first_name: customer?.first_name || "Applicant",
      last_name: customer?.last_name || "",
      license_state: fields.licenseState,
      license_number_ref: fields.licenseNumberRef,
      license_expiry: fields.licenseExpiry || null,
      status: "pending",
    });
    if (error) return { success: false, error: "Couldn't save. Please try again." };
  }

  await touchApplication(customerId);
  return { success: true };
}

// Generic document upload, reused by both License and Insurance steps.
// documentType: 'drivers_license' | 'proof_of_residence' | 'insurance_card'
export async function uploadApplicantDocument(
  customerId: string,
  documentType: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not signed in." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { success: false, error: "Choose a file first." };
  if (file.size > 10 * 1024 * 1024) return { success: false, error: "File is too large (max 10MB)." };

  const { data: customer } = await supabase
    .from("customer")
    .select("tenant_id")
    .eq("id", customerId)
    .single();
  if (!customer) return { success: false, error: "Something went wrong. Please try again." };

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${customer.tenant_id}/${customerId}/${documentType}/${Date.now()}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("applicant-documents")
    .upload(path, file, { upsert: false });

  if (uploadError) return { success: false, error: "Upload failed. Please try again." };

  const { error: recordError } = await supabase.from("customer_document").insert({
    tenant_id: customer.tenant_id,
    customer_id: customerId,
    document_type: documentType,
    storage_key: path,
    status: "active",
  });

  if (recordError) return { success: false, error: "Upload saved but couldn't be recorded. Contact support." };

  return { success: true };
}

// ---------------------------------------------------------------------------
// STEP 3: Work (gig platforms -- reuses gig_platform, same as the lead form)
// ---------------------------------------------------------------------------
export async function saveWorkStep(
  customerId: string,
  gigPlatformIds: string[]
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customer")
    .select("tenant_id")
    .eq("id", customerId)
    .single();
  if (!customer) return { success: false, error: "Something went wrong. Please try again." };

  // Replace the set: delete existing, insert the current selection. Simple
  // and correct for a form re-save; this table has no history requirement.
  await supabase.from("platform_eligibility").delete().eq("customer_id", customerId);

  if (gigPlatformIds.length > 0) {
    const rows = gigPlatformIds.map((gig_platform_id) => ({
      tenant_id: customer.tenant_id,
      customer_id: customerId,
      gig_platform_id,
      verification_status: "pending",
    }));
    const { error } = await supabase.from("platform_eligibility").insert(rows);
    if (error) return { success: false, error: "Couldn't save. Please try again." };
  }

  await touchApplication(customerId);
  return { success: true };
}

// ---------------------------------------------------------------------------
// STEP 4: Insurance
// ---------------------------------------------------------------------------
export async function saveInsuranceStep(
  customerId: string,
  fields: { provider: string; policyReference: string }
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customer")
    .select("tenant_id")
    .eq("id", customerId)
    .single();
  if (!customer) return { success: false, error: "Something went wrong. Please try again." };

  const { data: existing } = await supabase
    .from("insurance_policy")
    .select("id")
    .eq("customer_id", customerId)
    .eq("policy_type", "renter")
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("insurance_policy")
      .update({ provider: fields.provider, policy_reference: fields.policyReference })
      .eq("id", existing.id);
    if (error) return { success: false, error: "Couldn't save. Please try again." };
  } else {
    const { error } = await supabase.from("insurance_policy").insert({
      tenant_id: customer.tenant_id,
      customer_id: customerId,
      policy_type: "renter",
      provider: fields.provider,
      policy_reference: fields.policyReference,
      verification_status: "pending",
    });
    if (error) return { success: false, error: "Couldn't save. Please try again." };
  }

  await touchApplication(customerId);
  return { success: true };
}

// ---------------------------------------------------------------------------
// STEP 5: Review & Submit
// ---------------------------------------------------------------------------
export async function submitApplication(
  applicationId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("application")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", applicationId);

  if (error) return { success: false, error: "Couldn't submit. Please try again." };
  return { success: true };
}
