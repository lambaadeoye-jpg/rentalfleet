import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  submitted: "var(--warning, #f59e0b)",
  screening: "var(--warning, #f59e0b)",
  review: "var(--warning, #f59e0b)",
  approved: "var(--signal-green, #16a34a)",
  conditionally_approved: "var(--signal-green, #16a34a)",
  declined: "var(--red, #dc2626)",
  draft: "var(--text-secondary)",
  expired: "var(--text-secondary)",
};

export default async function ApplicationsPage() {
  const supabase = await createClient();

  const { data: applications } = await supabase
    .from("application")
    .select("id, status, submitted_at, created_at, customer:customer_id(first_name, last_name, email, phone)")
    .order("created_at", { ascending: false });

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Applications</h1>
      <p className="muted-text" style={{ marginBottom: 28 }}>
        {applications?.length ?? 0} total.
      </p>

      {!applications || applications.length === 0 ? (
        <p className="muted-text">No applications yet.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                {["Applicant", "Contact", "Status", "Submitted"].map((h) => (
                  <th key={h} style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)", fontWeight: 700 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => {
                const customer = app.customer as any;
                return (
                  <tr key={app.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "12px 16px" }}>
                      <Link href={`/staff/applications/${app.id}`} style={{ fontWeight: 600, color: "var(--text)" }}>
                        {customer?.first_name || customer?.last_name
                          ? `${customer?.first_name ?? ""} ${customer?.last_name ?? ""}`.trim()
                          : "(name not yet provided)"}
                      </Link>
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>
                      <div>{customer?.phone ?? "—"}</div>
                      {customer?.email && <div style={{ fontSize: 12 }}>{customer.email}</div>}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: STATUS_COLOR[app.status] ?? "var(--text-secondary)",
                          textTransform: "capitalize",
                        }}
                      >
                        {app.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--text-secondary)", fontSize: 13 }}>
                      {app.submitted_at ? new Date(app.submitted_at).toLocaleDateString() : "Not yet submitted"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
