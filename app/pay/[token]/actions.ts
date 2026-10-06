"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashUploadToken } from "@/lib/upload-token";
import { UPLOAD_TOKEN_RE } from "@/lib/upload-validation";
import { buildCheckoutBody } from "@/lib/checkout";
import { createCheckoutSession, stripeConfigured } from "@/lib/stripe";

const GENERIC = "We couldn't start the payment. Please try again.";

/** Renter ticked the refund-terms box and tapped Pay. Returns the Stripe page to send them to. */
export async function startCheckout(token: string, termsAccepted: boolean): Promise<{ success: true; url: string } | { success: false; error: string }> {
  if (!UPLOAD_TOKEN_RE.test(token)) return { success: false, error: "This link isn't active. Ask us for a new one." };
  if (!termsAccepted) return { success: false, error: "Please tick the box to confirm you've read the cancellation and refund terms." };
  if (!stripeConfigured()) return { success: false, error: "Card payments aren't available right now. Please contact us." };
  const admin = createAdminClient();
  if (!admin) return { success: false, error: GENERIC };

  const h = await headers();
  const ip = (h.get("x-nf-client-connection-ip") || (h.get("x-forwarded-for") ?? "").split(",")[0] || "unknown").trim().slice(0, 64);

  const { data: rows, error } = await admin.rpc("begin_checkout", { p_token_hash: hashUploadToken(token), p_ip: ip });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("agreement_not_signed")) return { success: false, error: "Please sign your rental agreement first, then come back to this link." };
    if (m.includes("not_open")) return { success: false, error: "This payment has already been completed." };
    if (m.includes("link_invalid")) return { success: false, error: "This link isn't active. Ask us for a new one." };
    return { success: false, error: GENERIC };
  }
  const r = Array.isArray(rows) ? rows[0] : null;
  if (!r) return { success: false, error: GENERIC };
  if (r.existing_url) return { success: true, url: r.existing_url };

  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://rentzivo.com").replace(/\/$/, "");
  const nowSeconds = Math.floor(Date.now() / 1000);
  const body = buildCheckoutBody({
    payRequestId: r.request_id,
    rentalId: r.rental_id,
    rentCents: r.rent_cents,
    depositCents: r.deposit_cents,
    customerEmail: r.email ?? null,
    successUrl: `${base}/pay/${token}?status=success`,
    cancelUrl: `${base}/pay/${token}?status=cancelled`,
    nowSeconds,
  });
  // Same 5-minute bucket => a double tap reuses one Stripe session instead of creating two.
  const res = await createCheckoutSession(body, `${r.request_id}:${Math.floor(nowSeconds / 300)}`);
  if (!res.ok) return { success: false, error: GENERIC };

  await admin.rpc("attach_checkout_session", {
    p_request_id: r.request_id,
    p_session_id: res.session.id,
    p_url: res.session.url,
    p_expires_at: new Date(res.session.expiresAt * 1000).toISOString(),
  });
  return { success: true, url: res.session.url };
}
