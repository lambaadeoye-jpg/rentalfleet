import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import StaffNav from "../staff-nav";
import SignOutButton from "./dashboard/sign-out-button";

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

  // Field staff get a genuinely different, mobile-first layout -- not the
  // desktop-oriented sidebar. They're standing next to a car on their
  // phone, not sitting at a desk managing leads and applications; a
  // sidebar built for back-office work is the wrong shape for that job,
  // even though nothing about it was actually broken for them.
  if (role?.name === "field_staff") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--cloud)" }}>
        <header
          style={{
            background: "var(--midnight)",
            color: "white",
            padding: "16px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "sticky",
            top: 0,
            zIndex: 40,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 15 }}>{tenant?.name ?? "Fleet Rental"}</span>
          <SignOutButton />
        </header>
        <main>{children}</main>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <StaffNav tenantName={tenant?.name ?? "Staff Portal"} userEmail={user.email ?? ""} roleName={role?.name} />
      <main style={{ flex: 1, background: "var(--cloud)", minHeight: "100vh" }}>{children}</main>
    </div>
  );
}
