"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createSigningLink } from "../applications/agreement-actions";
import { agreementSmsBody, decideAgreementEmail, decideAgreementSms, maskEmail, normalizeEmail, phoneNorm } from "@/lib/agreement-notice";
import { fireN8nWebhook, n8nConfigured, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";
import { sendViaTwilio, twilioConfigured } from "@/lib/twilio";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TextLinkResult = {
  success: boolean;
  error?: string;
  /** Present when a link was created but the text didn't go out, so staff can send it themselves. */
  url?: string;
  sentTo?: string;
};

/**
 * Creates the signing link and texts it to the renter in one step.
 * Every text rule is checked BEFORE the link is made, so a blocked text never cancels a link the renter already has.
 * The link is never stored anywhere in readable form: it exists only in the text and, on failure, on this screen.
 */
export async function textSigningLink(rentalId: string): Promise<TextLinkResult> {
  if (!UUID_RE.test(rentalId)) return { success: false, error: "Something went wrong. Please try again." };
  const supabase = await createClient();

  const { data: rental } = await supabase
    .from("rental")
    .select("id, tenant_id, status, customer_id, customer:customer_id(first_name, phone)")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) return { success: false, error: "Rental not found." };
  const customer = rental.customer as any;

  const norm = phoneNorm(customer?.phone);
  let suppressed = false;
  if (norm) {
    const { data: hit } = await supabase.from("contact_suppression").select("id").eq("tenant_id", rental.tenant_id).eq("phone_norm", norm).maybeSingle();
    suppressed = Boolean(hit);
  }

  const decision = decideAgreementSms({ phone: customer?.phone ?? null, suppressed, smsConfigured: twilioConfigured(), now: new Date() });
  if (decision.action === "blocked") return { success: false, error: decision.message };

  const made = await createSigningLink(rentalId);
  if (!made.success || !made.url) return { success: false, error: made.error ?? "Couldn’t create the link." };

  const support = (process.env.SUPPORT_PHONE || "").trim() || null;
  const body = agreementSmsBody(customer?.first_name ?? null, made.url, support);
  const sent = await sendViaTwilio(decision.to, body);
  if (!sent.ok) {
    console.error("[contracts] agreement text failed:", sent.error);
    return { success: false, url: made.url, error: "The link was created but the text didn’t go out. Copy the link below and send it yourself." };
  }

  // The record shows that a link was texted, not the link itself.
  await supabase.from("communication_event").insert({
    tenant_id: rental.tenant_id,
    customer_id: rental.customer_id,
    channel: "sms",
    direction: "outbound",
    event_type: "message",
    external_reference: sent.id ?? null,
    payload: { to: decision.to, body: agreementSmsBody(customer?.first_name ?? null, "[signing link]", support), automated: false, step: "agreement_link" },
  });

  revalidatePath("/staff/contracts");
  revalidatePath("/staff/inbox");
  return { success: true, sentTo: `•••• ${norm?.slice(-4) ?? ""}` };
}

/**
 * Creates the signing link and emails it through n8n. Same order of safety as the text:
 * every rule is checked BEFORE the link is made, and the link is never stored in readable form.
 */
export async function emailSigningLink(rentalId: string): Promise<TextLinkResult> {
  if (!UUID_RE.test(rentalId)) return { success: false, error: "Something went wrong. Please try again." };
  const supabase = await createClient();

  const { data: rental } = await supabase
    .from("rental")
    .select("id, tenant_id, customer_id, customer:customer_id(first_name, email)")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) return { success: false, error: "Rental not found." };
  const customer = rental.customer as any;

  const email = normalizeEmail(customer?.email);
  let suppressed = false;
  if (email) {
    const { data: hit } = await supabase.from("contact_suppression").select("id").eq("tenant_id", rental.tenant_id).eq("email", email).maybeSingle();
    suppressed = Boolean(hit);
  }
  const decision = decideAgreementEmail({ email: customer?.email ?? null, suppressed, emailConfigured: n8nConfigured() });
  if (decision.action === "blocked") return { success: false, error: decision.message };

  const made = await createSigningLink(rentalId);
  if (!made.success || !made.url) return { success: false, error: made.error ?? "Couldn’t create the link." };

  const delivered = await fireN8nWebhook(N8N_WEBHOOK_PATHS.agreementEmail, {
    to: decision.to,
    firstName: customer?.first_name ?? null,
    signingUrl: made.url,
    expiresInHours: 72,
    supportPhone: (process.env.SUPPORT_PHONE || "").trim() || null,
  });
  if (!delivered) {
    return { success: false, url: made.url, error: "The link was created but the email didn’t go out. Copy the link below and send it yourself." };
  }

  await supabase.from("communication_event").insert({
    tenant_id: rental.tenant_id,
    customer_id: rental.customer_id,
    channel: "email",
    direction: "outbound",
    event_type: "message",
    payload: { to: decision.to, body: "Rental agreement signing link emailed. [signing link]", automated: false, step: "agreement_link" },
  });

  revalidatePath("/staff/contracts");
  revalidatePath("/staff/inbox");
  return { success: true, sentTo: maskEmail(decision.to) ?? "the renter" };
}
