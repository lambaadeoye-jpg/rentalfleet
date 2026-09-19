import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSignedDocumentUrl } from "../actions";
import DecisionForm from "./decision-form";

export const dynamic = "force-dynamic";

const DOCUMENT_LABELS: Record<string, string> = {
  drivers_license: "Driver's License",
  proof_of_residence: "Proof of Residence",
  insurance_card: "Insurance Card",
};

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // No manual tenant_id filtering -- RLS (0014) scopes this application row,
  // and everything joined off it, to the signed-in staff member's own
  // tenant. A staff member from another tenant gets a null `application`
  // here, not someone else's data.
  const { data: application } = await supabase
    .from("application")
    .select(
      "id, status, submitted_at, decision_at, decision_reason, customer_id, customer:customer_id(first_name, last_name, email, phone)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!application) {
    return (
      <div style={{ padding: "32px 40px" }}>
        <p className="error-text">Application not found.</p>
        <Link href="/staff/applications" style={{ color: "var(--teal)" }}>
          Back to Applications
        </Link>
      </div>
    );
  }

  const customer = application.customer as any;
  const customerId = application.customer_id;

  const [{ data: driver }, { data: platformLinks }, { data: insurance }, { data: documents }] = await Promise.all([
    supabase
      .from("authorized_driver")
      .select("license_state, license_number_ref, status")
      .eq("customer_id", customerId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("platform_eligibility")
      .select("gig_platform:gig_platform_id(name)")
      .eq("customer_id", customerId),
    supabase
      .from("insurance_policy")
      .select("provider, policy_reference, verification_status")
      .eq("customer_id", customerId)
      .eq("policy_type", "renter")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("customer_document")
      .select("id, document_type, storage_key, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),
  ]);

  const platforms = (platformLinks ?? []).map((p) => (p.gig_platform as any)?.name).filter(Boolean);

  // Signed URLs generated server-side, respecting the same staff storage
  // RLS (0026) as everything else -- a staff member without access to this
  // tenant's documents gets null here, not a working URL.
  const documentsWithUrls = await Promise.all(
    (documents ?? []).map(async (doc) => ({
      ...doc,
      url: await getSignedDocumentUrl(doc.storage_key),
    }))
  );

  const isDecided = application.status !== "draft" && application.status !== "submitted" && application.status !== "screening" && application.status !== "review";

  return (
    <div style={{ padding: "32px 40px", maxWidth: 900 }}>
      <Link href="/staff/applications" style={{ color: "var(--teal)", fontSize: 13, fontWeight: 600 }}>
        ← Back to Applications
      </Link>
      <h1 style={{ fontSize: 22, margin: "8px 0 4px" }}>
        {customer?.first_name || customer?.last_name
          ? `${customer?.first_name ?? ""} ${customer?.last_name ?? ""}`.trim()
          : "(name not yet provided)"}
      </h1>
      <p className="muted-text" style={{ marginBottom: 28 }}>
        {customer?.phone ?? "No phone"} {customer?.email ? `· ${customer.email}` : ""}
      </p>

      <div className="grid-3" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>License</p>
          <p style={{ fontWeight: 600 }}>
            {driver ? `${driver.license_state ?? "—"} ${driver.license_number_ref ?? ""}` : "Not yet provided"}
          </p>
        </div>
        <div className="card">
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>Driving For</p>
          <p style={{ fontWeight: 600 }}>{platforms.length > 0 ? platforms.join(", ") : "Not yet selected"}</p>
        </div>
        <div className="card">
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>Insurance</p>
          <p style={{ fontWeight: 600 }}>{insurance?.provider || "Not yet provided"}</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Documents</h2>
        {documentsWithUrls.length === 0 ? (
          <p className="muted-text" style={{ fontSize: 14 }}>No documents uploaded yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {documentsWithUrls.map((doc) => (
              <div
                key={doc.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {DOCUMENT_LABELS[doc.document_type] ?? doc.document_type}
                </span>
                {doc.url ? (
                  <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal)", fontSize: 13, fontWeight: 600 }}>
                    View (link expires in 10 min)
                  </a>
                ) : (
                  <span className="muted-text" style={{ fontSize: 13 }}>Unavailable</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Decision</h2>
        {isDecided ? (
          <div>
            <p style={{ fontWeight: 700, marginBottom: 4, textTransform: "capitalize" }}>
              {application.status.replace(/_/g, " ")}
            </p>
            {application.decision_reason && (
              <p className="muted-text" style={{ fontSize: 14, marginBottom: 4 }}>{application.decision_reason}</p>
            )}
            {application.decision_at && (
              <p className="muted-text" style={{ fontSize: 13 }}>
                Decided {new Date(application.decision_at).toLocaleString()}
              </p>
            )}
          </div>
        ) : (
          <DecisionForm applicationId={application.id} />
        )}
      </div>
    </div>
  );
}
