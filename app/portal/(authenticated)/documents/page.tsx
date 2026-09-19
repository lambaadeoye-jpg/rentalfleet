import { createClient } from "@/lib/supabase/server";
import { FileText } from "lucide-react";

export const dynamic = "force-dynamic";

const DOCUMENT_LABELS: Record<string, string> = {
  drivers_license: "Driver's License",
  proof_of_residence: "Proof of Residence",
  insurance_card: "Insurance Card",
};

async function getSignedUrl(storageKey: string): Promise<string | null> {
  const supabase = await createClient();
  // Relies on the SAME storage RLS as the Application Workspace's own
  // uploads (migration 0026's applicant_own_documents_select) -- a
  // customer reading their own storage_key succeeds because customer and
  // applicant are the same auth_user_id-linked identity throughout this
  // build, not two separate access paths to keep in sync.
  const { data } = await supabase.storage.from("applicant-documents").createSignedUrl(storageKey, 600);
  return data?.signedUrl ?? null;
}

export default async function PortalDocumentsPage() {
  const supabase = await createClient();

  const { data: documents } = await supabase
    .from("customer_document")
    .select("id, document_type, storage_key, created_at")
    .order("created_at", { ascending: false });

  const documentsWithUrls = await Promise.all(
    (documents ?? []).map(async (doc) => ({ ...doc, url: await getSignedUrl(doc.storage_key) }))
  );

  return (
    <div style={{ padding: "24px 20px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Documents</h1>

      {documentsWithUrls.length === 0 ? (
        <p className="muted-text">No documents on file yet.</p>
      ) : (
        documentsWithUrls.map((doc) => (
          <a
            key={doc.id}
            href={doc.url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 10,
              textDecoration: "none",
              color: "var(--text)",
            }}
          >
            <FileText size={18} color="var(--teal)" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {DOCUMENT_LABELS[doc.document_type] ?? doc.document_type}
              </div>
              <div className="muted-text" style={{ fontSize: 12 }}>
                Uploaded {new Date(doc.created_at).toLocaleDateString()}
              </div>
            </div>
          </a>
        ))
      )}
    </div>
  );
}
