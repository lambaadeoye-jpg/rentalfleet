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

  // Real gap closed here: staff previously only learned about things
  // needing attention via SMS/email from n8n -- nothing surfaced in the
  // UI itself. These are the same counts the Dashboard already computes,
  // just now visible from anywhere in the nav, not only after navigating
  // to Dashboard specifically.
  const [{ count: newLeadsCount }, { count: pendingApplicationsCount }, { count: expiringInsuranceCount }, { count: readyForPickupCount }] =
    await Promise.all([
      supabase.from("lead").select("*", { count: "exact", head: true }).eq("stage", "new"),
      supabase.from("application").select("*", { count: "exact", head: true }).eq("status", "submitted"),
      supabase
        .from("insurance_policy")
        .select("*", { count: "exact", head: true })
        .eq("policy_type", "renter")
        .in("verification_status", ["pending", "document_received", "expiring_soon", "review_required"]),
      supabase.from("rental").select("*", { count: "exact", head: true }).eq("status", "scheduled"),
    ]);

  const badgeCounts: Record<string, number> = {
    "/staff/leads": newLeadsCount ?? 0,
    "/staff/applications": pendingApplicationsCount ?? 0,
    "/staff/insurance": expiringInsuranceCount ?? 0,
    "/staff/pickups": readyForPickupCount ?? 0,
  };

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
      <StaffNav tenantName={tenant?.name ?? "Staff Portal"} userEmail={user.email ?? ""} roleName={role?.name} badgeCounts={badgeCounts} />
      <main style={{ flex: 1, background: "var(--cloud)", minHeight: "100vh" }}>{children}</main>
    </div>
  );
}
