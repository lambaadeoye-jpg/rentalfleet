import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import StaffNav from "../staff-nav";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/staff/login");
  }

  const { data: membership } = await supabase
    .from("membership")
    .select("tenant:tenant_id(name), role:role_id(name)")
    .eq("user_id", user.id)
    .maybeSingle();

  const tenant = (membership?.tenant as any) ?? null;
  const role = (membership?.role as any) ?? null;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <StaffNav tenantName={tenant?.name ?? "Staff Portal"} userEmail={user.email ?? ""} roleName={role?.name} />
      <main style={{ flex: 1, background: "var(--cloud)", minHeight: "100vh" }}>{children}</main>
    </div>
  );
}
