import { NextResponse } from "next/server";
import { isAutomationAuthorized } from "@/lib/automation-auth";
import { createClient } from "@supabase/supabase-js";
import { decideNotice, type NoticeRow } from "@/lib/renter-notices";
import { sendViaTwilio, twilioConfigured } from "@/lib/twilio";
import { generateUploadToken } from "@/lib/upload-token";
import { cardUpdateUrl, CARD_LINK_HOURS } from "@/lib/card-update";

// Called every few minutes by an n8n Schedule trigger (never by a browser). Sends the texts queued by the database
// (cancellation, refund issued, payment received, weekly rent charged / failed) exactly once each.
//
// Safe by default: with no Twilio credentials or during quiet hours a notice goes back in the queue and is tried on the
// next run; the database drops anything older than 48 hours, so switching Twilio on later never sends stale news.
// A failed send is NOT retried (a duplicate text is worse than a missed one); staff can see it in the notice list.

type Claimed = NoticeRow & { id: string; tenant_id: string; customer_id: string; rental_id: string | null };

export async function POST(request: Request) {
  if (!isAutomationAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Line up tomorrow's rent reminders first. If this step fails (for example the database update isn't run yet),
  // the other notices still go out.
  const { error: reminderError } = await supabase.rpc("queue_rent_due_reminders");
  if (reminderError) console.warn("[renter-notices] rent reminders not queued:", reminderError.message);

  const { data: claimed, error } = await supabase.rpc("claim_renter_notices", { p_limit: 25 });
  if (error) {
    console.error("[renter-notices] claim failed:", error.message);
    return NextResponse.json({ error: "Claim failed" }, { status: 500 });
  }

  const support = (process.env.SUPPORT_PHONE || "").trim() || null;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://rentzivo.com";
  const smsConfigured = twilioConfigured();
  const counts = { sent: 0, skipped: 0, deferred: 0, failed: 0 };

  for (const row of (claimed ?? []) as Claimed[]) {
    try {
      let decision = decideNotice(row, new Date(), smsConfigured, support, { siteUrl });
      // A declined-card text carries a private update-card link. It is made only now, when the text is really going
      // out, so a deferred or skipped notice never replaces a link the renter already has. If the link can't be made
      // (payments switched off, database error) the text goes without it and asks them to contact us.
      if (decision.action === "send" && row.kind === "weekly_charge_failed") {
        const { token, hash } = generateUploadToken();
        const { error: linkError } = await supabase.rpc("create_card_update_request", { p_customer_id: row.customer_id, p_token_hash: hash, p_hours: CARD_LINK_HOURS });
        if (!linkError) decision = decideNotice(row, new Date(), smsConfigured, support, { siteUrl, cardUpdateUrl: cardUpdateUrl(token, siteUrl) });
      }
      if (decision.action === "skip") {
        counts.skipped++;
        await supabase.from("renter_notice").update({ status: "skipped", error: decision.reason }).eq("id", row.id);
        continue;
      }
      if (decision.action === "defer") {
        counts.deferred++;
        await supabase.from("renter_notice").update({ status: "queued", claimed_at: null }).eq("id", row.id).eq("status", "sending");
        continue;
      }
      const res = await sendViaTwilio(decision.to, decision.body);
      if (!res.ok) {
        counts.failed++;
        await supabase.from("renter_notice").update({ status: "failed", error: res.error ?? "sms_failed" }).eq("id", row.id);
        continue;
      }
      counts.sent++;
      await supabase.from("renter_notice").update({
        status: "sent", sent_at: new Date().toISOString(), provider_message_id: res.id ?? null, error: null,
      }).eq("id", row.id);
      await supabase.from("communication_event").insert({
        tenant_id: row.tenant_id, customer_id: row.customer_id,
        channel: "sms", direction: "outbound", event_type: "message",
        external_reference: res.id ?? null,
        payload: { to: row.phone, body: decision.body, automated: true, step: `notice_${row.kind}` },
      });
    } catch (e) {
      counts.failed++;
      console.error("[renter-notices] row failed:", (e as Error).message);
      await supabase.from("renter_notice").update({ status: "failed", error: `exception: ${(e as Error).message}`.slice(0, 200) }).eq("id", row.id);
    }
  }
  return NextResponse.json({ success: true, claimed: (claimed ?? []).length, ...counts, smsConfigured });
}
