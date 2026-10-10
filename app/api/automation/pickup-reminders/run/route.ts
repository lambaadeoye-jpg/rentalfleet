import { NextResponse } from "next/server";
import { isAutomationAuthorized } from "@/lib/automation-auth";
import { createClient } from "@supabase/supabase-js";
import { decideReminder, type DueMessage } from "@/lib/pickup-reminders";
import { portalBase } from "@/lib/portal-links";
import { sendViaTwilio, twilioConfigured } from "@/lib/twilio";

// Called every few minutes by an n8n Schedule trigger (never by a browser).
// The database hands back each due pickup reminder (24h / 4h / 2h) and each
// newly missed pickup exactly once; this route sends the text.
//
// Safe by default: with no Twilio credentials or during quiet hours the claim is
// released (not failed, not sent) and tried again on the next run, and the
// database only offers a reminder inside its own time window, so turning Twilio
// on later never sends a stale reminder.

type Claimed = DueMessage & { id: string; tenant_id: string; rental_id: string; customer_id: string };

export async function POST(request: Request) {
  if (!isAutomationAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: claimed, error } = await supabase.rpc("claim_due_pickup_messages", { p_limit: 25 });
  if (error) {
    console.error("[pickup-reminders] claim failed:", error.message);
    return NextResponse.json({ error: "Claim failed" }, { status: 500 });
  }

  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://rentzivo.com").replace(/\/$/, "");
  const link = `${portalBase(base)}/portal/rental`;
  const smsConfigured = twilioConfigured();
  const counts = { sent: 0, skipped: 0, deferred: 0, failed: 0 };

  for (const row of (claimed ?? []) as Claimed[]) {
    try {
      const decision = decideReminder(row, new Date(), smsConfigured, link);
      if (decision.action === "skip") {
        counts.skipped++;
        await supabase.from("pickup_reminder").update({ status: "skipped", error: decision.reason }).eq("id", row.id);
        continue;
      }
      if (decision.action === "defer") {
        counts.deferred++;
        await supabase.from("pickup_reminder").delete().eq("id", row.id).eq("status", "sending");
        continue;
      }
      const res = await sendViaTwilio(decision.to, decision.body);
      if (!res.ok) {
        // Not retried: a second text after an unknown failure risks a duplicate.
        counts.failed++;
        await supabase.from("pickup_reminder").update({ status: "failed", error: res.error ?? "sms_failed" }).eq("id", row.id);
        continue;
      }
      counts.sent++;
      await supabase.from("pickup_reminder").update({
        status: "sent", sent_at: new Date().toISOString(), provider_message_id: res.id ?? null, error: null,
      }).eq("id", row.id);
      await supabase.from("communication_event").insert({
        tenant_id: row.tenant_id, customer_id: row.customer_id,
        channel: "sms", direction: "outbound", event_type: "message",
        external_reference: res.id ?? null,
        payload: { to: row.phone, body: decision.body, automated: true, step: `pickup_${row.kind}` },
      });
    } catch (e) {
      counts.failed++;
      console.error("[pickup-reminders] row failed:", (e as Error).message);
      await supabase.from("pickup_reminder").update({ status: "failed", error: `exception: ${(e as Error).message}`.slice(0, 200) }).eq("id", row.id);
    }
  }
  return NextResponse.json({ success: true, claimed: (claimed ?? []).length, ...counts, smsConfigured });
}
