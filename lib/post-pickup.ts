// Sends the renter's house-rules message after pickup: a short text and the full message by email.
// Uses the same safeguards as every automated text (opt-out list, texting hours). Never throws: the pickup is already done.
import { createAdminClient } from "@/lib/supabase/admin";
import { decideAgreementSms, decideAgreementEmail, normalizeEmail, phoneNorm } from "./agreement-notice";
import { fireN8nWebhook, n8nConfigured, N8N_WEBHOOK_PATHS } from "./n8n-webhook";
import { sendViaTwilio, twilioConfigured } from "./twilio";
import { loadRuleValues } from "./handover-server";
import { postPickupMessage } from "./rental-rules";

export type PostPickupResult = { sms: "sent" | "skipped" | "failed"; email: "sent" | "skipped" | "failed"; reasons: string[] };

export async function sendPostPickupMessage(rentalId: string): Promise<PostPickupResult> {
  const result: PostPickupResult = { sms: "skipped", email: "skipped", reasons: [] };
  try {
    const admin = createAdminClient();
    if (!admin) return { ...result, reasons: ["no_service_key"] };
    const { data: rental } = await admin
      .from("rental")
      .select("id, tenant_id, customer_id, customer:customer_id(first_name, phone, email)")
      .eq("id", rentalId)
      .maybeSingle();
    if (!rental) return { ...result, reasons: ["rental_not_found"] };

    // A message goes out once per rental, even if pickup is somehow confirmed twice.
    const { data: existing } = await admin.from("pickup_handover").select("message_sent_at").eq("rental_id", rentalId).maybeSingle();
    if (existing?.message_sent_at) return { ...result, reasons: ["already_sent"] };

    const customer = rental.customer as any;
    const rules = await loadRuleValues(admin);
    const msg = postPickupMessage(rules, customer?.first_name ?? null);

    // Text
    const norm = phoneNorm(customer?.phone);
    let smsSuppressed = false;
    if (norm) {
      const { data: hit } = await admin.from("contact_suppression").select("id").eq("tenant_id", rental.tenant_id).eq("phone_norm", norm).maybeSingle();
      smsSuppressed = Boolean(hit);
    }
    const smsDecision = decideAgreementSms({ phone: customer?.phone ?? null, suppressed: smsSuppressed, smsConfigured: twilioConfigured(), now: new Date() });
    if (smsDecision.action === "send") {
      const sent = await sendViaTwilio(smsDecision.to, msg.sms);
      result.sms = sent.ok ? "sent" : "failed";
      if (!sent.ok) result.reasons.push("sms_failed");
      else {
        await admin.from("communication_event").insert({
          tenant_id: rental.tenant_id, customer_id: rental.customer_id, channel: "sms", direction: "outbound", event_type: "message",
          external_reference: sent.id ?? null, payload: { to: smsDecision.to, body: msg.sms, automated: true, step: "post_pickup_rules" },
        });
      }
    } else result.reasons.push(`sms_${smsDecision.code}`);

    // Email (through n8n)
    const email = normalizeEmail(customer?.email);
    let emailSuppressed = false;
    if (email) {
      const { data: hit } = await admin.from("contact_suppression").select("id").eq("tenant_id", rental.tenant_id).eq("email", email).maybeSingle();
      emailSuppressed = Boolean(hit);
    }
    const emailDecision = decideAgreementEmail({ email: customer?.email ?? null, suppressed: emailSuppressed, emailConfigured: n8nConfigured() });
    if (emailDecision.action === "send") {
      const ok = await fireN8nWebhook(N8N_WEBHOOK_PATHS.pickupReviewRequest, {
        rentalId, to: emailDecision.to, customerEmail: emailDecision.to, emailSubject: msg.emailSubject, emailText: msg.emailText,
      });
      result.email = ok ? "sent" : "failed";
      if (!ok) result.reasons.push("email_failed");
      else {
        await admin.from("communication_event").insert({
          tenant_id: rental.tenant_id, customer_id: rental.customer_id, channel: "email", direction: "outbound", event_type: "message",
          payload: { to: emailDecision.to, body: msg.emailText, automated: true, step: "post_pickup_rules" },
        });
      }
    } else result.reasons.push(`email_${emailDecision.code}`);

    if (result.sms === "sent" || result.email === "sent") {
      await admin.from("pickup_handover").upsert(
        { rental_id: rentalId, tenant_id: rental.tenant_id, message_sent_at: new Date().toISOString(), message_channels: { sms: result.sms, email: result.email } },
        { onConflict: "rental_id" },
      );
    }
  } catch (e) {
    console.error("[post-pickup] failed:", e);
    result.reasons.push("error");
  }
  return result;
}
