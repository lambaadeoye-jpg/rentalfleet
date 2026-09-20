"use server";

import { createClient } from "@/lib/supabase/server";

export async function getMyStaffProfile(): Promise<{ fullName: string; email: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { fullName: "", email: "" };

  const { data } = await supabase.from("user_profile").select("full_name, email").eq("id", user.id).maybeSingle();
  return { fullName: data?.full_name ?? "", email: data?.email ?? "" };
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
