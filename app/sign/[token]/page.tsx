import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashUploadToken } from "@/lib/upload-token";
import { UPLOAD_TOKEN_RE } from "@/lib/upload-validation";
import type { RenderedAgreement } from "@/lib/agreement";
import SignForm from "./sign-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign your rental agreement",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px" }}>
      <p style={{ fontWeight: 800, fontSize: 18, marginBottom: 16 }}>Zivo</p>
      {children}
    </main>
  );
}

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
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

  const { data: rows } = await admin.rpc("get_sign_request", { p_token_hash: hashUploadToken(token) });
  const req = Array.isArray(rows) ? rows[0] : null;
  if (!req) return invalid;

  if (req.signed_at) {
    let url: string | null = null;
    if (req.storage_key) {
      const { data } = await admin.storage.from("applicant-documents").createSignedUrl(req.storage_key, 600);
      url = data?.signedUrl ?? null;
    }
    return (
      <Shell>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Agreement signed. Thank you!</h1>
        <p className="muted-text" style={{ marginBottom: 16 }}>
          Signed on {new Date(req.signed_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "long", timeStyle: "short" })} Central.
          Keep a copy for your records.
        </p>
        {url && <a className="button-primary" href={url} style={{ display: "inline-flex" }}>Download your copy (PDF)</a>}
      </Shell>
    );
  }

  const rendered = req.rendered as RenderedAgreement;
  return (
    <Shell>
      <h1 style={{ fontSize: 24, marginBottom: 6 }}>{req.first_name ? `${req.first_name}, please ` : "Please "}review and sign</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Read the agreement, initial the highlighted clauses, then type your full legal name to sign. Link expires{" "}
        {new Date(req.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })}.
      </p>
      <SignForm token={token} rendered={rendered} />
    </Shell>
  );
}
