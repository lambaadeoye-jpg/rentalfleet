"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Every on/off switch staff can flip from Settings. Anything not listed here is rejected,
// so this action can't be used to write arbitrary tenant settings.
export const SWITCHES = [
  { key: "agreement_signing_enabled", label: "Rental agreement signing links", defaultOn: true,
    help: "Turn off to stop every signing link immediately. Nothing is deleted; turn it back on and the same links work again." },
  { key: "upload_links_enabled", label: "Document upload links", defaultOn: true,
    help: "Turn off to stop every document upload link immediately." },
  { key: "auto_refunds_enabled", label: "Auto-approve small refunds", defaultOn: false,
    help: "A renter's own cancellation with a refund under the approval limit, all to their card, is approved automatically. Everything else still needs staff." },
] as const;

export type SwitchKey = (typeof SWITCHES)[number]["key"];
export type SwitchState = { key: string; label: string; help: string; on: boolean };

export async function getSwitches(): Promise<SwitchState[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("tenant_setting").select("key, value").in("key", SWITCHES.map((s) => s.key));
  const m = Object.fromEntries((data ?? []).map((s) => [s.key, (s.value ?? "").toLowerCase()]));
  return SWITCHES.map((s) => ({
    key: s.key, label: s.label, help: s.help,
    on: m[s.key] === "on" ? true : m[s.key] === "off" ? false : s.defaultOn,
  }));
}

export async function saveSwitch(key: string, on: boolean): Promise<{ success: boolean; error?: string }> {
  if (!SWITCHES.some((s) => s.key === key)) return { success: false, error: "Unknown setting." };
  const supabase = await createClient();
  const { data: tenantRow } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenantRow) return { success: false, error: "Something went wrong. Please try again." };
  const { error } = await supabase.from("tenant_setting").upsert(
    [{ tenant_id: tenantRow.id, key, value: on ? "on" : "off" }],
    { onConflict: "tenant_id,key" }
  );
  if (error) {
    if (error.message?.toLowerCase().includes("permission")) return { success: false, error: "You don't have permission to change this setting." };
    return { success: false, error: "Couldn't save. Please try again." };
  }
  revalidatePath("/staff/settings");
  return { success: true };
}
