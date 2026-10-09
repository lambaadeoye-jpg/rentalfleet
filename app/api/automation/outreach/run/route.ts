import { unsubscribeUrl } from "@/lib/unsubscribe";
import { isAutomationAuthorized } from "@/lib/automation-auth";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fireN8nWebhook, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";
import { processRow, type ClaimedRow, type Deps } from "@/lib/outreach-dispatch";
import { sendViaTwilio, twilioConfigured } from "@/lib/twilio";

// Called every minute by an n8n Schedule trigger (never by a browser).
// Claims due outreach rows, applies the compliance rules in
// lib/outreach-rules.ts, and sends. Same shared-secret + service-role
// pattern as the other /api/automation routes.
//
// Safe by default: with no Twilio credentials, texts are deferred (not
// failed, not sent); rows more than 6 hours late are dropped, so turning
// Twilio on later does not flush a backlog of stale messages.

const RETRY_MINUTES = 5;

export async function POST(request: Request) {
  if (!isAutomationAuthorized(request)) {
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
  const smsConfigured = twilioConfigured();
  const deps: Deps = {
    smsConfigured,
    sendSms: sendViaTwilio,
    fireCall: (leadId) => fireN8nWebhook(N8N_WEBHOOK_PATHS.newLeadCallTrigger, { leadId, source: "outreach_dispatcher" }),
    fireEmail: (payload) => fireN8nWebhook(N8N_WEBHOOK_PATHS.outreachEmail, payload),
    applyLink: `${base}/apply`,
    unsubscribeUrl: (email) => unsubscribeUrl(base, email),
    now: new Date(),
  };

  // A text that went out must be marked sent, or a later run could send it again. Retry once, and make noise if it still fails.
  async function mark(id: string, patch: Record<string, unknown>): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { error } = await supabase.from("outreach_message").update(patch).eq("id", id);
      if (!error) return;
      if (attempt === 1) console.error("[outreach] COULD NOT RECORD STATUS (risk of a duplicate send) for", id, error.message);
    }
  }

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
      await mark(row.id, {
        status: "sent", sent_at: new Date().toISOString(), provider_message_id: outcome.providerId ?? null, error: null,
      });
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
      await mark(row.id, { status: "skipped", skip_reason: outcome.reason });
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
      await mark(row.id, patch);
    } else if (outcome.final) {
      counts.failed++;
      await mark(row.id, { status: "failed", error: outcome.error });
    } else {
      counts.retry++;
      await mark(row.id, {
        status: "queued", claimed_at: null, error: outcome.error,
        scheduled_for: new Date(Date.now() + RETRY_MINUTES * 60 * 1000).toISOString(),
      });
    }
  }

  return NextResponse.json({ success: true, claimed: (claimed ?? []).length, ...counts, smsConfigured });
}
