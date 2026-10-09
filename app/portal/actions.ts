"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Same low-friction magic-link pattern as the Application Workspace’s
// resume flow (/apply/resume) -- a customer who already has an active
// rental has definitely provided an email by this point (required to get
// here at all: approved application -> started rental), so there’s no
// anonymous-first case to handle like /apply has. Straight to magic link.
export async function sendPortalMagicLink(email: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { success: false, error: "Enter a valid email address." };

  // A customer created by staff has no sign-in yet. Give them one (the link still only goes to that inbox),
  // otherwise they could never open the portal.
  try {
    const admin = createAdminClient();
    if (admin) {
      const { data: matches } = await admin.from("customer").select("id, auth_user_id").eq("email", trimmed).limit(2);
      if (matches && matches.length === 1 && !matches[0].auth_user_id) {
        const { data: created, error: createError } = await admin.auth.admin.createUser({ email: trimmed, email_confirm: true });
        if (!createError && created?.user) {
          await admin.from("customer").update({ auth_user_id: created.user.id }).eq("id", matches[0].id).is("auth_user_id", null);
        }
      }
    }
  } catch (e) {
    console.error("[portal login] could not prepare sign-in:", e instanceof Error ? e.message : e);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      shouldCreateUser: false, // portal sign-in only -- a real customer record must already exist
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback?next=/portal`,
    },
  });

  if (error) {
    // Never echo the provider's message: it can reveal whether an email has an account.
    console.error("[portal login] link not sent:", error.message);
    if (/rate|too many|seconds/i.test(error.message)) return { success: false, error: "Too many tries. Wait a minute and try again." };
  }
  return { success: true };
}

export async function updateProfile(fields: {
  firstName: string;
  lastName: string;
  phone: string;
}): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not signed in." };

  const firstName = fields.firstName.trim().slice(0, 60);
  const lastName = fields.lastName.trim().slice(0, 60);
  if (!firstName || !lastName) return { success: false, error: "Enter your first and last name." };
  const digits = fields.phone.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return { success: false, error: "Enter a 10-digit US phone number." };

  const { error } = await supabase
    .from("customer")
    .update({
      first_name: firstName,
      last_name: lastName,
      phone: `+1${ten}`,
    })
    .eq("auth_user_id", user.id);

  if (error) return { success: false, error: "Couldn’t save. Please try again." };
  return { success: true };
}

export async function createSupportTicket(subject: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = subject.trim().slice(0, 200);
  if (!trimmed) return { success: false, error: "Enter a subject." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not signed in." };

  const { data: customer } = await supabase
    .from("customer")
    .select("id, tenant_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!customer) return { success: false, error: "Something went wrong. Please try again." };

  const { error } = await supabase.from("support_ticket").insert({
    tenant_id: customer.tenant_id,
    customer_id: customer.id,
    subject: trimmed,
    status: "open",
    priority: "normal",
  });

  if (error) return { success: false, error: "Couldn’t submit. Please try again." };
  return { success: true };
}
