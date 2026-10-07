import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { sentenceCase } from "@/lib/format-label";
import { formatPhone } from "@/lib/format-phone";

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
    <div className="page">
      <h1 className="page-title">Applications</h1>
      <p className="muted-text" style={{ marginBottom: 28 }}>
        {applications?.length ?? 0} total.
      </p>

      {!applications || applications.length === 0 ? (
        <p className="muted-text">No applications yet.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                {["Applicant", "Contact", "Status", "Submitted"].map((h) => (
                  <th key={h}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => {
                const customer = app.customer as any;
                return (
                  <tr key={app.id}>
                    <td>
                      <Link href={`/staff/applications/${app.id}`} style={{ fontWeight: 600, color: "var(--text)" }}>
                        {customer?.first_name || customer?.last_name
                          ? `${customer?.first_name ?? ""} ${customer?.last_name ?? ""}`.trim()
                          : "(name not yet provided)"}
                      </Link>
                    </td>
                    <td className="cell-muted">
                      <div>{customer?.phone ? formatPhone(customer.phone) : "—"}</div>
                      {customer?.email && <div style={{ fontSize: 12 }}>{customer.email}</div>}
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: STATUS_COLOR[app.status] ?? "var(--text-secondary)",
                        }}
                      >
                        {sentenceCase(app.status)}
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
