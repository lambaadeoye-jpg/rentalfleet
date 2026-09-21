"use server";

import { createClient } from "@/lib/supabase/server";

// Real gap this closes: /staff/login previously used email/password, but
// the staff invite flow (accept_staff_invite, migration 0032) is entirely
// magic-link/OTP based and never sets a password for the invited person.
// Confirmed directly against the live database before fixing: only the
// original seed admin has a password at all -- anyone invited through
// /staff/team, including every future field_staff hire, would have had
// no way to log back in after their first session.
//
// shouldCreateUser: false, matching /portal's pattern -- staff sign-in
// only works for a membership that already exists (created via the
// invite flow), this isn't a signup path.
export async function sendStaffMagicLink(email: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = email.trim();
  if (!trimmed) return { success: false, error: "Enter your email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback?next=/staff/dashboard`,
    },
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}
