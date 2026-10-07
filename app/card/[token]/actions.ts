"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashUploadToken } from "@/lib/upload-token";
import { UPLOAD_TOKEN_RE } from "@/lib/upload-validation";
import { createCheckoutSession, stripeConfigured } from "@/lib/stripe";
import { buildSetupSessionBody } from "@/lib/card-update";

const GENERIC = "We couldn't open the card page. Please try again.";

/** Renter ticked the authorization box and tapped Save. Returns the Stripe page to send them to. */
export async function startCardUpdate(token: string, authorized: boolean): Promise<{ success: true; url: string } | { success: false; error: string }> {
  if (!UPLOAD_TOKEN_RE.test(token)) return { success: false, error: "This link isn't active. Ask us for a new one." };
  if (!authorized) return { success: false, error: "Please tick the box to confirm." };
  if (!stripeConfigured()) return { success: false, error: "Card updates aren't available right now. Please contact us." };
  const admin = createAdminClient();
  if (!admin) return { success: false, error: GENERIC };

  const h = await headers();
  const ip = (h.get("x-nf-client-connection-ip") || (h.get("x-forwarded-for") ?? "").split(",")[0] || "unknown").trim().slice(0, 64);

  const { data: rows, error } = await admin.rpc("begin_card_update", { p_token_hash: hashUploadToken(token), p_ip: ip });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("not_open")) return { success: false, error: "Your card has already been updated. Thank you!" };
    if (m.includes("link_invalid")) return { success: false, error: "This link isn't active. Ask us for a new one." };
    return { success: false, error: GENERIC };
  }
  const r = Array.isArray(rows) ? rows[0] : null;
  if (!r) return { success: false, error: GENERIC };
  if (r.existing_url) return { success: true, url: r.existing_url };

  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://rentzivo.com").replace(/\/$/, "");
  const nowSeconds = Math.floor(Date.now() / 1000);
  const params = {
    requestId: r.request_id as string,
    stripeCustomerId: (r.stripe_customer_id as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    successUrl: `${base}/card/${token}?status=success`,
    cancelUrl: `${base}/card/${token}?status=cancelled`,
    nowSeconds,
  };
  // Same 5-minute bucket => a double tap reuses one Stripe session instead of creating two.
  const key = `card:${r.request_id}:${Math.floor(nowSeconds / 300)}`;
  let res = await createCheckoutSession(buildSetupSessionBody({ ...params, includeEmail: true }), key);
  // Stripe sometimes rejects an email prefill; the email is optional, so retry once without it.
  if (!res.ok) res = await createCheckoutSession(buildSetupSessionBody({ ...params, includeEmail: false }), `${key}:b`);
  if (!res.ok) return { success: false, error: GENERIC };

  await admin.rpc("attach_card_update_session", {
    p_request_id: r.request_id,
    p_session_id: res.session.id,
    p_url: res.session.url,
    p_expires_at: new Date(res.session.expiresAt * 1000).toISOString(),
  });
  return { success: true, url: res.session.url };
}
