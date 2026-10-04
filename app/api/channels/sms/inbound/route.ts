import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { fireN8nWebhook, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";

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
  const { data: matchedCustomer } = await supabase
    .from("customer")
    .select("id")
    .eq("tenant_id", tenantRow.id)
    .eq("phone", fromPhone)
    .limit(1)
    .maybeSingle();

  let leadId: string | null = null;
  if (!matchedCustomer) {
    const { data: matchedLead } = await supabase
      .from("lead")
      .select("id")
      .eq("tenant_id", tenantRow.id)
      .eq("phone", fromPhone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    leadId = matchedLead?.id ?? null;
  }

  const { error: insertError } = await supabase.from("communication_event").insert({
    tenant_id: tenantRow.id,
    customer_id: matchedCustomer?.id ?? null,
    lead_id: leadId,
    channel: "sms",
    direction: "inbound",
    event_type: "message",
    external_reference: messageSid,
    payload: { from: fromPhone, body: messageBody ?? "" },
  });

  if (insertError) {
    console.error("[sms-inbound] Failed to log communication_event:", insertError);
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
