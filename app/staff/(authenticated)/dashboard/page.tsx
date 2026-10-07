import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { greeting } from "@/lib/greeting";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Field staff have no reason to land on a metrics dashboard they can’t
  // act on -- their one relevant page is Pickups & Dropoffs. Redirect
  // rather than showing them a page full of numbers about leads and
  // applications they have no permission to work with.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: membership } = await supabase
      .from("membership")
      .select("role:role_id(name)")
      .eq("user_id", user.id)
      .maybeSingle();
    const roleName = (membership?.role as any)?.name;
    if (roleName === "field_staff") {
      redirect("/staff/pickups");
    }
  }

  // No manual tenant_id filtering anywhere here -- RLS (0014) scopes every
  // one of these queries to the signed-in staff member’s own tenant.
  const [{ count: newLeads }, { count: pendingApplications }, { count: totalLeads }, { count: activeRentals }] =
    await Promise.all([
      supabase.from("lead").select("*", { count: "exact", head: true }).eq("stage", "new"),
      supabase.from("application").select("*", { count: "exact", head: true }).eq("status", "submitted"),
      supabase.from("lead").select("*", { count: "exact", head: true }),
      supabase.from("rental").select("*", { count: "exact", head: true }).eq("status", "active"),
    ]);

  return (
    <div className="page">
      <h1 className="page-title">{greeting()}.</h1>
      <p className="muted-text" style={{ marginBottom: 28 }}>
        Here&rsquo;s what needs your attention.
      </p>

      <div className="grid-3">
        <div className="card">
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>New leads</p>
          <p style={{ fontSize: 32, fontWeight: 800 }}>{newLeads ?? 0}</p>
        </div>
        <div className="card">
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>Applications to review</p>
          <p style={{ fontSize: 32, fontWeight: 800, color: (pendingApplications ?? 0) > 0 ? "var(--warning, #f59e0b)" : undefined }}>
            {pendingApplications ?? 0}
          </p>
        </div>
        <div className="card">
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>Total leads (all time)</p>
          <p style={{ fontSize: 32, fontWeight: 800 }}>{totalLeads ?? 0}</p>
        </div>
        <div className="card">
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>Active rentals</p>
          <p style={{ fontSize: 32, fontWeight: 800 }}>{activeRentals ?? 0}</p>
        </div>
      </div>
    </div>
  );
}
