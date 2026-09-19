"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type StaffMember = {
  user_id: string;
  full_name: string | null;
  email: string;
  role_name: string;
};

export type PendingInvite = {
  id: string;
  email: string;
  role_name: string;
  created_at: string;
};

export async function getTeamData(): Promise<{ staff: StaffMember[]; invites: PendingInvite[] }> {
  const supabase = await createClient();

  const [{ data: memberships }, { data: invites }] = await Promise.all([
    supabase
      .from("membership")
      .select("user_id, role:role_id(name), user_profile:user_id(full_name, email)"),
    supabase
      .from("staff_invite")
      .select("id, email, created_at, role:role_id(name)")
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const staff = (memberships ?? []).map((m) => ({
    user_id: m.user_id,
    full_name: (m.user_profile as any)?.full_name ?? null,
    email: (m.user_profile as any)?.email ?? "—",
    role_name: (m.role as any)?.name ?? "—",
  }));

  const pendingInvites = (invites ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    role_name: (i.role as any)?.name ?? "—",
    created_at: i.created_at,
  }));

  return { staff, invites: pendingInvites };
}

export async function getRoles(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("role").select("id, name").order("name");
  return data ?? [];
}

// Creates the invite record AND sends the actual magic-link email in one
// action -- an invite that exists in the database but was never emailed
// would just be a confusing dead end for whoever created it.
export async function inviteStaffMember(email: string, roleId: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = email.trim();
  if (!trimmed) return { success: false, error: "Enter an email address." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not signed in." };

  const { data: membership } = await supabase
    .from("membership")
    .select("tenant_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return { success: false, error: "Something went wrong. Please try again." };

  // Permission-gated at the database level (migration 0032's
  // staff_invite_manage_users_roles_guard, requiring manage_users_roles).
  const { error: insertError } = await supabase.from("staff_invite").insert({
    tenant_id: membership.tenant_id,
    email: trimmed,
    role_id: roleId,
    invited_by: user.id,
  });

  if (insertError) {
    if (insertError.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to invite staff." };
    }
    return { success: false, error: "Couldn't create the invite. Please try again." };
  }

  const { error: emailError } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback?next=/staff/onboard`,
    },
  });

  if (emailError) {
    // The invite record exists even if the email send failed -- worth
    // surfacing distinctly rather than implying nothing happened.
    return { success: false, error: `Invite created, but the email couldn't be sent: ${emailError.message}` };
  }

  revalidatePath("/staff/team");
  return { success: true };
}

export async function revokeInvite(inviteId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("staff_invite").delete().eq("id", inviteId);

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to revoke invites." };
    }
    return { success: false, error: "Couldn't revoke that invite. Please try again." };
  }

  revalidatePath("/staff/team");
  return { success: true };
}
