import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { fireN8nWebhook, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";
import { parseInboundKeyword, HELP_REPLY, renderTemplate } from "@/lib/outreach-rules";
import { YES_REPLY, CHANGE_REPLY, formatPickupWhen } from "@/lib/pickup-reminders";

// Twilio POSTs here the moment someone texts the business number. This is
// third-party-initiated, not an internal call, so it's authenticated with
// Twilio's own signature scheme (HMAC-SHA1 of the URL + sorted form params,
// keyed with the account's auth token) rather than the AUTOMATION_API_SECRET
// pattern used for our own internal n8n-to-app calls elsewhere -- that
// secret is ours to share with n8n; Twilio has no way to know it.
function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string, authToken: string): boolean {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  const expected = createHmac("sha1", authToken).update(data, "utf-8").digest("base64");

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return timingSafeEqual(expectedBuf, signatureBuf);
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!authToken || !serviceRoleKey || !supabaseUrl) {
    console.error("[sms-inbound] Missing TWILIO_AUTH_TOKEN, SUPABASE_SERVICE_ROLE_KEY, or NEXT_PUBLIC_SUPABASE_URL");
    return new NextResponse("", { status: 500 });
  }

  const rawBody = await request.text();
  const formParams = new URLSearchParams(rawBody);
  const params: Record<string, string> = {};
  formParams.forEach((value, key) => {
    params[key] = value;
  });

  const signature = request.headers.get("x-twilio-signature");
  const fullUrl = request.url;
  if (!signature || !verifyTwilioSignature(fullUrl, params, signature, authToken)) {
    console.error("[sms-inbound] Invalid Twilio signature -- rejecting");
    return new NextResponse("", { status: 403 });
  }

  const fromPhone = params["From"];
  const messageBody = params["Body"];
  const messageSid = params["MessageSid"];
  if (!fromPhone || !messageSid) {
    return new NextResponse("", { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: tenantRow } = await supabase.from("tenant").select("id").eq("status", "active").limit(1).maybeSingle();
  if (!tenantRow) {
    console.error("[sms-inbound] No active tenant found");
    return new NextResponse("", { status: 500 });
  }

  // Match against an existing customer first (more established
  // relationship), then an existing lead. Deliberately does NOT create a
  // new lead for an unmatched number -- lead.email is a required field
  // (migration 0052), and a first-time texter has no email yet. Rather
  // than invent one, this logs the message unlinked; staff see it in the
  // inbox and can create/link a real lead once they actually have enough
  // information (name, email) from the conversation itself.
  // Phones are stored in mixed formats, so match on the last 10 digits via
  // the service-role-only match_caller_by_phone() rather than exact equality
  // (an exact match silently missed "+1..." vs "615..." variants).
  const { data: matches } = await supabase.rpc("match_caller_by_phone", {
    p_tenant_id: tenantRow.id,
    p_phone: fromPhone,
  });
  const top = ((matches ?? []) as { kind: string; id: string; customer_id: string | null }[])[0];
  const matchedCustomer = top?.kind === "customer" ? { id: top.id } : null;
  const leadId: string | null = top?.kind === "lead" ? top.id : null;

  // Opt-out and re-subscribe keywords. Twilio's own default handling already
  // sends the STOP/START confirmation texts, so we only record the state
  // (which also cancels every queued follow-up for that number).
  const keyword = parseInboundKeyword(messageBody ?? "");
  if (keyword === "stop") {
    const { error: optErr } = await supabase.rpc("record_opt_out", { p_tenant_id: tenantRow.id, p_phone: fromPhone });
    if (optErr) console.error("[sms-inbound] record_opt_out failed:", optErr);
  } else if (keyword === "start") {
    const { error: optErr } = await supabase.rpc("clear_opt_out", { p_tenant_id: tenantRow.id, p_phone: fromPhone });
    if (optErr) console.error("[sms-inbound] clear_opt_out failed:", optErr);
  }

  const { error: insertError } = await supabase.from("communication_event").insert({
    tenant_id: tenantRow.id,
    customer_id: matchedCustomer?.id ?? null,
    lead_id: leadId,
    channel: "sms",
    direction: "inbound",
    // YES / CHANGE show up in the Inbox as a callback request for staff.
    event_type: keyword === "yes" || keyword === "change" ? "callback_request" : "message",
    external_reference: messageSid,
    payload: { from: fromPhone, body: messageBody ?? "" },
  });

  if (insertError) {
    console.error("[sms-inbound] Failed to log communication_event:", insertError);
  }

  // A YES / CHANGE answering a recent pickup reminder is recorded against the rental
  // and answered right here. Anything else falls through to the normal flow.
  if ((keyword === "yes" || keyword === "change") && matchedCustomer) {
    const { data: replyRows } = await supabase.rpc("record_pickup_reply", { p_tenant_id: tenantRow.id, p_phone: fromPhone, p_keyword: keyword });
    const rr = Array.isArray(replyRows) ? replyRows[0] : null;
    if (rr) {
      const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://rentzivo.com").replace(/\/$/, "");
      const msg = keyword === "yes"
        ? renderTemplate(YES_REPLY, { when: formatPickupWhen(rr.pickup_at, rr.location_tz, new Date()), place: rr.location_name ?? "our pickup location" })
        : renderTemplate(CHANGE_REPLY, { link: `${base}/portal/rental` });
      if (keyword === "change") {
        void fireN8nWebhook(N8N_WEBHOOK_PATHS.inboxNewMessageAlert, {
          fromPhone, messageBody: messageBody ?? "", matched: true, customerId: matchedCustomer.id, leadId,
        });
      }
      const esc = msg.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return new NextResponse(`<Response><Message>${esc}</Message></Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
    }
  }

  // Opt-out bookkeeping needs no staff alert. HELP gets a reply if a support
  // contact is configured (otherwise Twilio's default HELP reply applies).
  if (keyword === "stop" || keyword === "start") {
    return new NextResponse("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
  }
  if (keyword === "help" && process.env.SUPPORT_PHONE && process.env.SUPPORT_EMAIL) {
    const msg = renderTemplate(HELP_REPLY, { support_phone: process.env.SUPPORT_PHONE, support_email: process.env.SUPPORT_EMAIL });
    const esc = msg.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return new NextResponse(`<Response><Message>${esc}</Message></Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
  }

  // Staff alert goes through n8n, same as every other notification in
  // this build -- never sent directly from this route.
  void fireN8nWebhook(N8N_WEBHOOK_PATHS.inboxNewMessageAlert, {
    fromPhone,
    messageBody: messageBody ?? "",
    matched: Boolean(matchedCustomer || leadId),
    customerId: matchedCustomer?.id ?? null,
    leadId,
  });

  // Twilio expects TwiML or an empty 200 -- never JSON.
  return new NextResponse("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
