"use server";

import { createClient } from "@/lib/supabase/server";

export async function getMyStaffProfile(): Promise<{ fullName: string; email: string; isAdmin: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { fullName: "", email: "", isAdmin: false };

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("user_profile").select("full_name, email").eq("id", user.id).maybeSingle(),
    supabase.from("membership").select("role:role_id(name)").eq("user_id", user.id).maybeSingle(),
  ]);

  const roleName = (membership?.role as any)?.name;
  return { fullName: profile?.full_name ?? "", email: profile?.email ?? "", isAdmin: roleName === "admin" };
}

// No permission gate needed here -- editing your own name/contact info
// isn't a role-restricted action, it's available to every staff member
// regardless of role. tenant_isolation_update (0014) already scopes this
// correctly; RLS doesn't need a permission trigger for "edit your own row."
export async function updateMyStaffProfile(fullName: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not signed in." };

  const { error } = await supabase.from("user_profile").update({ full_name: fullName.trim() }).eq("id", user.id);

  if (error) return { success: false, error: "Couldn't save. Please try again." };
  return { success: true };
}

// Optional, additive password for admin specifically -- never required,
// never a replacement for magic link, which stays the permanent
// unconditional fallback so the invited-staff-lockout bug fixed earlier
// can never resurface. Restricted to admin (not field_staff) both here
// and in the UI that calls this -- field_staff are more likely to use
// shared/company devices, where a saved password is a real, avoidable
// risk this role doesn't need to carry.
export async function setMyStaffPassword(password: string): Promise<{ success: boolean; error?: string }> {
  if (password.length < 8) return { success: false, error: "Password must be at least 8 characters." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not signed in." };

  const { data: membership } = await supabase.from("membership").select("role:role_id(name)").eq("user_id", user.id).maybeSingle();
  const roleName = (membership?.role as any)?.name;
  if (roleName !== "admin") {
    return { success: false, error: "Password sign-in is only available for admin accounts." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { success: false, error: error.message };
  return { success: true };
}