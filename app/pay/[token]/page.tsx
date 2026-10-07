import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashUploadToken } from "@/lib/upload-token";
import { UPLOAD_TOKEN_RE } from "@/lib/upload-validation";
import { money } from "@/lib/agreement";
import PayForm from "./pay-form";
import AutoRefresh from "./auto-refresh";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pay for your rental",
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

export default async function PayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ status?: string }> }) {
  const { token } = await params;
  const { status } = await searchParams;
  const invalid = (
    <Shell>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>This link isn&rsquo;t active</h1>
      <p className="muted-text">It may have expired or been replaced by a newer one. Please contact us and we&rsquo;ll send a fresh link.</p>
    </Shell>
  );
  if (!UPLOAD_TOKEN_RE.test(token)) return invalid;
  const admin = createAdminClient();
  if (!admin) return invalid;

  const { data: rows } = await admin.rpc("get_pay_request", { p_token_hash: hashUploadToken(token) });
  const req = Array.isArray(rows) ? rows[0] : null;
  if (!req) return invalid;

  if (req.status === "paid") {
    return (
      <Shell>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Payment received. Thank you!</h1>
        <p className="muted-text">You&rsquo;re all set. We&rsquo;ll send your pickup details. Keep your photo ID and the card you paid with.</p>
      </Shell>
    );
  }
  if (req.status === "review") {
    return (
      <Shell>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>We&rsquo;re checking your payment</h1>
        <p className="muted-text">Your payment needs a quick look from our team. We&rsquo;ll contact you shortly. You don&rsquo;t need to pay again.</p>
      </Shell>
    );
  }
  if (req.status !== "open") return invalid;

  // Back from Stripe but the webhook hasn’t landed yet: refresh until it does.
  if (status === "success") {
    return (
      <Shell>
        <AutoRefresh />
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Confirming your payment...</h1>
        <p className="muted-text">This takes a few seconds. Please don&rsquo;t pay again.</p>
      </Shell>
    );
  }

  const total = (req.rent_cents + req.deposit_cents) / 100;
  return (
    <Shell>
      <h1 style={{ fontSize: 24, marginBottom: 6 }}>{req.first_name ? `${req.first_name}, ` : ""}pay to lock in your rental</h1>
      {status === "cancelled" && <p className="muted-text" style={{ marginBottom: 12 }}>Payment wasn&rsquo;t completed. You can try again below.</p>}
      <div className="card" style={{ marginBottom: 14 }}>
        {req.rent_cents > 0 && (
          <p style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 }}><span>Rent (first week)</span><span>{money(req.rent_cents / 100)}</span></p>
        )}
        {req.deposit_cents > 0 && (
          <p style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 }}><span>Refundable deposit</span><span>{money(req.deposit_cents / 100)}</span></p>
        )}
        <p style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 700, borderTop: "1px solid var(--border, #ddd)", paddingTop: 8 }}>
          <span>Total today</span><span>{money(total)}</span>
        </p>
      </div>
      <PayForm token={token} terms={Array.isArray(req.terms_lines) ? (req.terms_lines as string[]) : []} totalLabel={money(total)} />
    </Shell>
  );
}
