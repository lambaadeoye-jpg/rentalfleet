"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loadRuleValues } from "@/lib/handover-server";
import { DEFAULT_INSURANCE_LINE } from "@/lib/rental-rules";

export type RulesSettings = {
  ticketPayHours: string;
  ticketReviewThreshold: string;
  maintenanceDays: string;
  instagram: string;
  insuranceLine: string;
  // Shown read-only: these come from the approved agreement.
  fromAgreement: { label: string; value: string }[];
};

export async function getRulesSettings(): Promise<RulesSettings> {
  const supabase = await createClient();
  const v = await loadRuleValues(supabase);
  return {
    ticketPayHours: String(v.ticketPayHours),
    ticketReviewThreshold: String(v.ticketReviewThreshold),
    maintenanceDays: String(v.maintenanceDays),
    instagram: v.instagram,
    insuranceLine: v.insuranceLine,
    fromAgreement: [
      { label: "Where the car may be driven", value: v.travelArea },
      { label: "Late rent fee", value: `$${v.lateRentFee} after ${v.lateRentCutoff} on the due date` },
      { label: "Late return and recovery fee", value: `$${v.lateReturnFee}` },
      { label: "Toll", value: `$${v.tollFee} each, the whole charge` },
      { label: "Ticket admin fee", value: `$${v.adminFee}` },
      { label: "Deductible", value: `$${v.deductible}` },
    ],
  };
}

function wholeNumber(v: string, min: number, max: number): number | null {
  const s = v.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

export async function saveRulesSettings(input: {
  ticketPayHours: string; ticketReviewThreshold: string; maintenanceDays: string; instagram: string; insuranceLine: string;
}): Promise<{ success: boolean; error?: string }> {
  const hours = wholeNumber(input.ticketPayHours, 1, 168);
  const threshold = wholeNumber(input.ticketReviewThreshold, 1, 100);
  const days = wholeNumber(input.maintenanceDays, 7, 365);
  if (hours === null) return { success: false, error: "Ticket payment time must be 1 to 168 hours." };
  if (threshold === null) return { success: false, error: "Ticket review number must be 1 to 100." };
  if (days === null) return { success: false, error: "Maintenance interval must be 7 to 365 days." };
  const handle = input.instagram.trim().replace(/^@/, "");
  if (handle && !/^[A-Za-z0-9._]{1,30}$/.test(handle)) return { success: false, error: "Instagram handle can only use letters, numbers, dots and underscores." };
  const insurance = input.insuranceLine.trim();
  if (insurance.length > 400) return { success: false, error: "Keep the insurance line under 400 characters." };

  const supabase = await createClient();
  const { data: tenantRow } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenantRow) return { success: false, error: "Something went wrong. Please try again." };

  const rows = [
    { tenant_id: tenantRow.id, key: "rules_ticket_pay_hours", value: String(hours) },
    { tenant_id: tenantRow.id, key: "rules_ticket_review_threshold", value: String(threshold) },
    { tenant_id: tenantRow.id, key: "rules_maintenance_days", value: String(days) },
    { tenant_id: tenantRow.id, key: "rules_instagram", value: handle ? `@${handle}` : "" },
    { tenant_id: tenantRow.id, key: "rules_insurance_line", value: insurance === DEFAULT_INSURANCE_LINE ? "" : insurance },
  ];
  const { error } = await supabase.from("tenant_setting").upsert(rows, { onConflict: "tenant_id,key" });
  if (error) {
    if (error.message?.toLowerCase().includes("permission")) return { success: false, error: "You don’t have permission to change these settings." };
    return { success: false, error: "Couldn’t save. Please try again." };
  }
  revalidatePath("/staff/settings");
  revalidatePath("/staff/pickups");
  return { success: true };
}
