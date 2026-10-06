"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { fireN8nWebhook, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";

export type ConversationSummary = {
  key: string; // "customer:<id>" or "lead:<id>" or "unlinked:<phone>"
  customerId: string | null;
  leadId: string | null;
  displayName: string;
  phone: string | null;
  lastMessage: string;
  lastMessageAt: string;
  lastDirection: string;
  channel: string;
};

export type ConversationMessage = {
  id: string;
  channel: string;
  direction: string;
  body: string;
  createdAt: string;
};

// Groups raw communication_event rows into conversations client-side --
// genuinely small data volume at this stage (nothing writes to this table
// yet in production), so no need for a dedicated SQL grouping query.
export async function getConversations(): Promise<ConversationSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("communication_event")
    .select(
      "id, customer_id, lead_id, channel, direction, payload, created_at, customer:customer_id(first_name, last_name, phone), lead:lead_id(first_name, last_name, phone)"
    )
    // Only human-readable events. Voice audit rows (call_identified,
    // auth_succeeded, tool_*...) share this table and must not render as
    // blank "Unknown" conversations. callback_request rows ARE shown --
    // that's how an unmatched caller's request reaches staff.
    .in("event_type", ["message", "callback_request"])
    .order("created_at", { ascending: false })
    .limit(200);

  if (!data) return [];

  const byKey = new Map<string, ConversationSummary>();
  for (const row of data) {
    const customer = row.customer as unknown as { first_name: string; last_name: string; phone: string | null } | null;
    const lead = row.lead as unknown as { first_name: string; last_name: string; phone: string | null } | null;
    const payload = row.payload as { from?: string; body?: string } | null;

    const key = row.customer_id ? `customer:${row.customer_id}` : row.lead_id ? `lead:${row.lead_id}` : `unlinked:${payload?.from ?? "unknown"}`;
    if (byKey.has(key)) continue; // already have the most recent (sorted desc)

    const displayName = customer
      ? `${customer.first_name} ${customer.last_name}`
      : lead
        ? `${lead.first_name} ${lead.last_name}`
        : payload?.from ?? "Unknown";
    const phone = customer?.phone ?? lead?.phone ?? payload?.from ?? null;

    byKey.set(key, {
      key,
      customerId: row.customer_id,
      leadId: row.lead_id,
      displayName,
      phone,
      lastMessage: payload?.body ?? "",
      lastMessageAt: row.created_at,
      lastDirection: row.direction,
      channel: row.channel,
    });
  }

  return Array.from(byKey.values());
}

export async function getConversationMessages(customerId: string | null, leadId: string | null, phone: string | null): Promise<ConversationMessage[]> {
  const supabase = await createClient();
  let query = supabase
    .from("communication_event")
    .select("id, channel, direction, payload, created_at")
    .in("event_type", ["message", "callback_request"])
    .order("created_at", { ascending: true });

  if (customerId) {
    query = query.eq("customer_id", customerId);
  } else if (leadId) {
    query = query.eq("lead_id", leadId);
  } else if (phone) {
    query = query.is("customer_id", null).is("lead_id", null).filter("payload->>from", "eq", phone);
  } else {
    return [];
  }

  const { data } = await query;
  return (data ?? []).map((row) => ({
    id: row.id,
    channel: row.channel,
    direction: row.direction,
    body: (row.payload as { body?: string } | null)?.body ?? "",
    createdAt: row.created_at,
  }));
}

export async function sendReply(fields: {
  customerId: string | null;
  leadId: string | null;
  phone: string;
  channel: string;
  message: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!fields.message.trim()) {
    return { success: false, error: "Message can't be empty." };
  }
  if (!fields.phone.trim()) {
    return { success: false, error: "No phone number on file for this conversation." };
  }

  const supabase = await createClient();
  const { data: tenantRow } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenantRow) return { success: false, error: "Something went wrong. Please try again." };

  // Log first, same pattern as every other write-then-notify action in
  // this build (recordPayment, approveCharge, etc.) -- the row is the
  // record of what staff sent; the actual send happens via n8n/Twilio,
  // consistent with every other outbound message in this system rather
  // than a new direct-API pattern introduced just for this feature.
  const { error: insertError } = await supabase.from("communication_event").insert({
    tenant_id: tenantRow.id,
    customer_id: fields.customerId,
    lead_id: fields.leadId,
    channel: fields.channel,
    direction: "outbound",
    event_type: "message",
    payload: { body: fields.message.trim() },
  });

  if (insertError) {
    if (insertError.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to send messages." };
    }
    return { success: false, error: "Couldn't send that message. Please try again." };
  }

  void fireN8nWebhook(N8N_WEBHOOK_PATHS.inboxSendReply, {
    phone: fields.phone,
    channel: fields.channel,
    message: fields.message.trim(),
  });

  revalidatePath("/staff/inbox");
  return { success: true };
}
