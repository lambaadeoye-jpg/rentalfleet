import type { SupabaseClient } from "@supabase/supabase-js";

/** Office roles: the owner/admin and the manager/VA. Field runners are not office. */
export function isOfficeRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

/** The signed-in user's role name ("admin", "manager", "field_staff"), or null. */
export async function currentRoleName(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("membership").select("role:role_id(name)").eq("user_id", user.id).maybeSingle();
  return ((data?.role as any)?.name as string | undefined) ?? null;
}

export async function currentUser(supabase: SupabaseClient): Promise<{ id: string; role: string | null } | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("membership").select("role:role_id(name)").eq("user_id", user.id).maybeSingle();
  return { id: user.id, role: ((data?.role as any)?.name as string | undefined) ?? null };
}
