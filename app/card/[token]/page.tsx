import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashUploadToken } from "@/lib/upload-token";
import { UPLOAD_TOKEN_RE } from "@/lib/upload-validation";
import { CARD_AUTHORIZATION_TEXT } from "@/lib/card-update";
import CardForm from "./card-form";
import AutoRefresh from "./auto-refresh";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Update your card",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "32px 16px" }}>
      <p style={{ fontWeight: 800, fontSize: 18, marginBottom: 16 }}>Zivo</p>
      {children}
    </main>
  );
}

export default async function CardPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ status?: string }> }) {
  const { token } = await params;
  const { status } = await searchParams;
  const invalid = (
    <Shell>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>This link isn&rsquo;t active</h1>
      <p className="muted-text">It may have expired or been replaced by a newer one. Log in to your portal to get a new link, or contact us.</p>
    </Shell>
  );
  if (!UPLOAD_TOKEN_RE.test(token)) return invalid;
  const admin = createAdminClient();
  if (!admin) return invalid;

  const { data: rows } = await admin.rpc("get_card_update_request", { p_token_hash: hashUploadToken(token) });
  const req = Array.isArray(rows) ? rows[0] : null;
  if (!req) return invalid;

  if (req.status === "completed") {
    return (
      <Shell>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Your card has been updated. Thank you!</h1>
        <p className="muted-text">We&rsquo;ll use this card for your next weekly rent charge. Nothing was charged just now.</p>
      </Shell>
    );
  }
  if (req.status !== "open") return invalid;

  // Back from Stripe but the confirmation hasn’t landed yet: refresh until it does.
  if (status === "success") {
    return (
      <Shell>
        <AutoRefresh />
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Saving your card...</h1>
        <p className="muted-text">This takes a few seconds. You don&rsquo;t need to do anything else.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 style={{ fontSize: 24, marginBottom: 6 }}>{req.first_name ? `${req.first_name}, ` : ""}update your card</h1>
      {status === "cancelled" && <p className="muted-text" style={{ marginBottom: 12 }}>Your card wasn&rsquo;t saved. You can try again below.</p>}
      <p className="muted-text" style={{ marginBottom: 16 }}>
        Add a new card for your weekly rent. We use your newest card for your next charge. Nothing is charged today.
      </p>
      <CardForm token={token} authorization={CARD_AUTHORIZATION_TEXT} />
    </Shell>
  );
}
