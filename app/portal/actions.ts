"use server";

import { createClient } from "@/lib/supabase/server";

// Same low-friction magic-link pattern as the Application Workspace's
// resume flow (/apply/resume) -- a customer who already has an active
// rental has definitely provided an email by this point (required to get
// here at all: approved application -> started rental), so there's no
// anonymous-first case to handle like /apply has. Straight to magic link.
export async function sendPortalMagicLink(email: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = email.trim();
  if (!trimmed) return { success: false, error: "Enter your email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      shouldCreateUser: false, // portal sign-in only -- a real customer record must already exist
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback?next=/portal`,
    },
  });

  if (error) return { success: false, error: error.message };
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

  const { error } = await supabase
    .from("customer")
    .update({
      first_name: fields.firstName.trim(),
      last_name: fields.lastName.trim(),
      phone: fields.phone.trim(),
    })
    .eq("auth_user_id", user.id);

  if (error) return { success: false, error: "Couldn't save. Please try again." };
  return { success: true };
}

export async function createSupportTicket(subject: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = subject.trim();
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

  if (error) return { success: false, error: "Couldn't submit. Please try again." };
  return { success: true };
}
