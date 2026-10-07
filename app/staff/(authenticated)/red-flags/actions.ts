"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit-log";

export type RedFlagEntry = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  reason: string;
  status: string;
  createdAt: string;
};

export type FlaggedLead = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  matchType: string;
  createdAt: string;
};

export async function getRedFlagEntries(): Promise<RedFlagEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("red_flag")
    .select("id, first_name, last_name, phone, email, reason, status, created_at")
    .order("created_at", { ascending: false });

  return (data ?? []).map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    email: r.email,
    reason: r.reason,
    status: r.status,
    createdAt: r.created_at,
  }));
}

// Leads that matched -- surfaced separately so staff can see the actual
// impact of the list (who got flagged), not just the list itself.
export async function getFlaggedLeads(): Promise<FlaggedLead[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lead")
    .select("id, first_name, last_name, phone, email, red_flag_match_type, created_at")
    .eq("red_flag_matched", true)
    .order("created_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((l) => ({
    id: l.id,
    firstName: l.first_name ?? "",
    lastName: l.last_name ?? "",
    phone: l.phone,
    email: l.email,
    matchType: l.red_flag_match_type ?? "unknown",
    createdAt: l.created_at,
  }));
}

// Permission-gated at the database level (red_flag_write_guard, requiring
// approve_driver -- migration 0054). Manual add, exactly as requested:
// a form on the staff/admin dashboard, not just an automated pipeline.
export async function addRedFlagEntry(fields: {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  reason: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!fields.reason.trim()) {
    return { success: false, error: "A reason is required -- this list is only as trustworthy as its evidence." };
  }
  if (!fields.phone.trim() && !fields.email.trim() && !(fields.firstName.trim() && fields.lastName.trim())) {
    return { success: false, error: "Provide at least a phone, email, or full name to match against." };
  }

  const supabase = await createClient();
  const { data: tenantRow } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenantRow) return { success: false, error: "Something went wrong. Please try again." };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("red_flag").insert({
    tenant_id: tenantRow.id,
    first_name: fields.firstName.trim() || null,
    last_name: fields.lastName.trim() || null,
    phone: fields.phone.trim() || null,
    email: fields.email.trim() || null,
    reason: fields.reason.trim(),
    added_by: user?.id ?? null,
  });

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don’t have permission to add to the red flag list." };
    }
    return { success: false, error: "Couldn’t add that entry. Please try again." };
  }

  void logAuditEvent({
    tenantId: tenantRow.id,
    action: "red_flag_added",
    entityType: "red_flag",
    entityId: "",
    afterData: { phone: fields.phone || null, email: fields.email || null, reason: fields.reason },
    source: "staff_portal",
  });

  revalidatePath("/staff/red-flags");
  return { success: true };
}

export async function resolveRedFlagEntry(entryId: string, note: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: entry } = await supabase.from("red_flag").select("id, tenant_id").eq("id", entryId).single();
  if (!entry) return { success: false, error: "Entry not found." };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("red_flag")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: user?.id ?? null,
      resolved_note: note.trim() || null,
    })
    .eq("id", entryId);

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don’t have permission to resolve entries." };
    }
    return { success: false, error: "Couldn’t resolve that entry." };
  }

  void logAuditEvent({
    tenantId: entry.tenant_id,
    action: "red_flag_resolved",
    entityType: "red_flag",
    entityId: entryId,
    afterData: { note },
    source: "staff_portal",
  });

  revalidatePath("/staff/red-flags");
  return { success: true };
}
