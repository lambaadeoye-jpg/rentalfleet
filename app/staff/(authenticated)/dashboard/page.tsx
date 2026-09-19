import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  // No manual tenant_id filtering anywhere here -- RLS (0014) scopes every
  // one of these queries to the signed-in staff member's own tenant.
  const [{ count: newLeads }, { count: pendingApplications }, { count: totalLeads }, { count: activeRentals }] =
    await Promise.all([
      supabase.from("lead").select("*", { count: "exact", head: true }).eq("stage", "new"),
      supabase.from("application").select("*", { count: "exact", head: true }).eq("status", "submitted"),
      supabase.from("lead").select("*", { count: "exact", head: true }),
      supabase.from("rental").select("*", { count: "exact", head: true }).eq("status", "active"),
    ]);

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Good morning.</h1>
      <p className="muted-text" style={{ marginBottom: 28 }}>
        Here&apos;s what needs your attention.
      </p>

      <div className="grid-3">
        <div className="card">
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>New Leads</p>
          <p style={{ fontSize: 32, fontWeight: 800 }}>{newLeads ?? 0}</p>
        </div>
        <div className="card">
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>Applications to Review</p>
          <p style={{ fontSize: 32, fontWeight: 800, color: (pendingApplications ?? 0) > 0 ? "var(--warning, #f59e0b)" : undefined }}>
            {pendingApplications ?? 0}
          </p>
        </div>
        <div className="card">
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>Total Leads (all time)</p>
          <p style={{ fontSize: 32, fontWeight: 800 }}>{totalLeads ?? 0}</p>
        </div>
        <div className="card">
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>Active Rentals</p>
          <p style={{ fontSize: 32, fontWeight: 800 }}>{activeRentals ?? 0}</p>
        </div>
      </div>
    </div>
  );
}
