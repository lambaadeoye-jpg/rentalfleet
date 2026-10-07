import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashUploadToken } from "@/lib/upload-token";
import { UPLOAD_TOKEN_RE, DOCUMENT_LABELS, DOCUMENT_HINTS } from "@/lib/upload-validation";
import UploadForm, { type UploadItem } from "./upload-form";

export const dynamic = "force-dynamic";

// A private link: keep it out of search engines and don’t leak it in referrers.
export const metadata: Metadata = {
  title: "Upload your documents",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "32px 16px" }}>
      <p style={{ fontWeight: 800, fontSize: 18, marginBottom: 16 }}>Zivo</p>
      {children}
    </main>
  );
}

export default async function UploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invalid = (
    <Shell>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>This link isn&rsquo;t active</h1>
      <p className="muted-text">It may have expired or been replaced by a newer one. Please contact us and we&rsquo;ll send a fresh link.</p>
    </Shell>
  );

  if (!UPLOAD_TOKEN_RE.test(token)) return invalid;
  const admin = createAdminClient();
  if (!admin) return invalid;

  const { data: rows } = await admin.rpc("get_upload_request", { p_token_hash: hashUploadToken(token) });
  const req = Array.isArray(rows) ? rows[0] : null;
  if (!req) return invalid;

  const { data: docs } = await admin
    .from("customer_document")
    .select("document_type, review_status, review_note, created_at")
    .eq("customer_id", req.customer_id)
    .in("document_type", req.document_types)
    .order("created_at", { ascending: false });

  const latest = new Map<string, { review_status: string; review_note: string | null }>();
  for (const d of docs ?? []) if (!latest.has(d.document_type)) latest.set(d.document_type, d);

  const items: UploadItem[] = (req.document_types as string[]).map((type) => ({
    type,
    label: DOCUMENT_LABELS[type] ?? type,
    hint: DOCUMENT_HINTS[type] ?? "",
    reviewStatus: latest.get(type)?.review_status ?? null,
    reviewNote: latest.get(type)?.review_note ?? null,
  }));

  return (
    <Shell>
      <h1 style={{ fontSize: 24, marginBottom: 6 }}>{req.first_name ? `Hi ${req.first_name}, ` : ""}upload your documents</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Take a clear photo with your phone or choose a file. This link is just for you and expires on{" "}
        {new Date(req.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })}.
      </p>
      <UploadForm token={token} items={items} />
    </Shell>
  );
}
