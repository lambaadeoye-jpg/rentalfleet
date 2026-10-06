import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fireN8nWebhook, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";
import { processRow, type ClaimedRow, type Deps } from "@/lib/outreach-dispatch";

// Called every minute by an n8n Schedule trigger (never by a browser).
// Claims due outreach rows, applies the compliance rules in
// lib/outreach-rules.ts, and sends. Same shared-secret + service-role
// pattern as the other /api/automation routes.
//
// Safe by default: with no Twilio credentials, texts are deferred (not
// failed, not sent); rows more than 6 hours late are dropped, so turning
// Twilio on later does not flush a backlog of stale messages.

const RETRY_MINUTES = 5;

async function sendViaTwilio(to: string, body: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || (!service && !from)) return { ok: false, error: "twilio_not_configured" };
  const form = new URLSearchParams({ To: to, Body: body });
  if (service) form.set("MessagingServiceSid", service);
  else if (from) form.set("From", from);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) return { ok: false, error: `twilio_${res.status}: ${json.message ?? "error"}`.slice(0, 200) };
    return { ok: true, id: json.sid };
  } catch (e) {
    return { ok: false, error: `twilio_network: ${(e as Error).message}`.slice(0, 200) };
  }
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-automation-secret");
  if (!secret || secret !== process.env.AUTOMATION_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: claimed, error: claimError } = await supabase.rpc("claim_due_outreach", { p_limit: 25 });
  if (claimError) {
    console.error("[outreach] claim failed:", claimError);
    return NextResponse.json({ error: "Claim failed" }, { status: 500 });
  }

  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://rentzivo.com").replace(/\/$/, "");
  const smsConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
    (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER)
  );
  const deps: Deps = {
    smsConfigured,
    sendSms: sendViaTwilio,
    fireCall: (leadId) => fireN8nWebhook(N8N_WEBHOOK_PATHS.newLeadCallTrigger, { leadId, source: "outreach_dispatcher" }),
    fireEmail: (payload) => fireN8nWebhook(N8N_WEBHOOK_PATHS.outreachEmail, payload),
    applyLink: `${base}/apply`,
    now: new Date(),
  };

  const counts = { sent: 0, skipped: 0, deferred: 0, retry: 0, failed: 0 };
  for (const row of (claimed ?? []) as ClaimedRow[]) {
    let outcome;
    try {
      outcome = await processRow(row, deps);
    } catch (e) {
      outcome = { kind: "retry" as const, error: `exception: ${(e as Error).message}`.slice(0, 200), final: row.attempts >= 3 };
    }

    if (outcome.kind === "sent") {
      counts.sent++;
      await supabase.from("outreach_message").update({
        status: "sent", sent_at: new Date().toISOString(), provider_message_id: outcome.providerId ?? null, error: null,
      }).eq("id", row.id);
      if (row.channel === "sms" && outcome.body) {
        // Show automated texts in the Inbox thread so staff see the full conversation.
        await supabase.from("communication_event").insert({
          tenant_id: row.tenant_id, customer_id: row.customer_id, lead_id: row.lead_id,
          channel: "sms", direction: "outbound", event_type: "message",
          external_reference: outcome.providerId ?? null,
          payload: { to: row.phone, body: outcome.body, automated: true, step: row.step_key },
        });
      }
    } else if (outcome.kind === "skipped") {
      counts.skipped++;
      await supabase.from("outreach_message").update({ status: "skipped", skip_reason: outcome.reason }).eq("id", row.id);
    } else if (outcome.kind === "deferred") {
      counts.deferred++;
      // Deferral is not an attempt.
      // A missing provider keeps the ORIGINAL schedule so the row goes stale
      // (and is dropped) instead of being pushed forward forever; quiet hours
      // move it to the next send window.
      const patch: Record<string, unknown> = {
        status: "queued", claimed_at: null,
        attempts: Math.max(0, row.attempts - 1), skip_reason: null, error: outcome.reason,
      };
      if (outcome.reason !== "sms_provider_not_configured") patch.scheduled_for = outcome.until.toISOString();
      await supabase.from("outreach_message").update(patch).eq("id", row.id);
    } else if (outcome.final) {
      counts.failed++;
      await supabase.from("outreach_message").update({ status: "failed", error: outcome.error }).eq("id", row.id);
    } else {
      counts.retry++;
      await supabase.from("outreach_message").update({
        status: "queued", claimed_at: null, error: outcome.error,
        scheduled_for: new Date(Date.now() + RETRY_MINUTES * 60 * 1000).toISOString(),
      }).eq("id", row.id);
    }
  }

  return NextResponse.json({ success: true, claimed: (claimed ?? []).length, ...counts, smsConfigured });
}
