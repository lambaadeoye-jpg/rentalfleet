"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { slotErrorMessage, confirmOutcomeMessage, DEFAULT_TIMEZONE, type Slot } from "@/lib/pickup-slots";

// Renter-facing pickup booking (Phase 3A). Every call authenticates the
// signed-in renter, resolves THEIR customer and latest rental, and passes
// those verified ids to the database functions, which re-check ownership.
// Nothing here trusts an id sent from the browser except the location and
// slot being chosen, and the database validates both.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Ctx = { admin: NonNullable<ReturnType<typeof createAdminClient>>; customerId: string; tenantId: string; rentalId: string; rentalStatus: string };

async function getContext(): Promise<Ctx | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;

  const { data: customer } = await supabase.from("customer").select("id, tenant_id").eq("auth_user_id", auth.user.id).maybeSingle();
  if (!customer) return null;
  const { data: rental } = await supabase
    .from("rental")
    .select("id, status")
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!rental) return null;
  return { admin, customerId: customer.id, tenantId: customer.tenant_id, rentalId: rental.id, rentalStatus: rental.status };
}

export type PickerLocation = { id: string; name: string; address: string; timezone: string };
export type PickerState = {
  enabled: boolean;
  canPick: boolean; // rental is scheduled and the feature is on
  requirePayment: boolean;
  locations: PickerLocation[];
  current: { holdId: string; startsAt: string; locationName: string; timezone: string } | null;
  pending: { holdId: string; startsAt: string; expiresAt: string; locationName: string; timezone: string } | null;
};

const EMPTY: PickerState = { enabled: false, canPick: false, requirePayment: false, locations: [], current: null, pending: null };

export async function getPickerState(): Promise<PickerState> {
  const ctx = await getContext();
  if (!ctx) return EMPTY;
  const { admin, tenantId, rentalId, rentalStatus } = ctx;

  const { data: settings } = await admin
    .from("tenant_setting")
    .select("key, value")
    .eq("tenant_id", tenantId)
    .in("key", ["slot_picker_enabled", "slot_require_payment"]);
  const map = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]));
  if (map.slot_picker_enabled !== "on") return EMPTY;

  const { data: rules } = await admin.from("pickup_slot_rule").select("location_id").eq("tenant_id", tenantId).eq("active", true);
  const ids = [...new Set((rules ?? []).map((r) => r.location_id))];
  const { data: locs } = ids.length
    ? await admin.from("location").select("id, name, address_line1, city, state, timezone").eq("tenant_id", tenantId).eq("active", true).in("id", ids)
    : { data: [] as any[] };
  const locations: PickerLocation[] = (locs ?? []).map((l: any) => ({
    id: l.id,
    name: l.name,
    address: [l.address_line1, l.city, l.state].filter(Boolean).join(", "),
    timezone: l.timezone || DEFAULT_TIMEZONE,
  }));
  const locById = new Map(locations.map((l) => [l.id, l]));

  const { data: holds } = await admin
    .from("slot_hold")
    .select("id, location_id, slot_start, status, expires_at")
    .eq("rental_id", rentalId)
    .in("status", ["held", "confirmed"]);

  let current: PickerState["current"] = null;
  let pending: PickerState["pending"] = null;
  for (const h of holds ?? []) {
    const loc = locById.get(h.location_id);
    if (!loc) continue;
    if (h.status === "confirmed") current = { holdId: h.id, startsAt: h.slot_start, locationName: loc.name, timezone: loc.timezone };
    else if (h.status === "held" && new Date(h.expires_at).getTime() > Date.now())
      pending = { holdId: h.id, startsAt: h.slot_start, expiresAt: h.expires_at, locationName: loc.name, timezone: loc.timezone };
  }

  return {
    enabled: true,
    canPick: rentalStatus === "scheduled" && locations.length > 0,
    requirePayment: map.slot_require_payment === "on",
    locations,
    current,
    pending,
  };
}

export async function listPickupSlots(locationId: string, fromDate?: string): Promise<{ success: boolean; slots: Slot[]; error?: string }> {
  if (!UUID_RE.test(locationId)) return { success: false, slots: [], error: "That pickup location isn't available." };
  if (fromDate && !DATE_RE.test(fromDate)) return { success: false, slots: [], error: "Something went wrong. Please try again." };
  const ctx = await getContext();
  if (!ctx) return { success: false, slots: [], error: "Please sign in again." };

  const { data, error } = await ctx.admin.rpc("list_pickup_slots", {
    p_rental_id: ctx.rentalId,
    p_customer_id: ctx.customerId,
    p_location_id: locationId,
    p_from: fromDate ?? null,
    p_days: 7,
  });
  if (error) return { success: false, slots: [], error: slotErrorMessage(error.message) };
  const slots: Slot[] = (data ?? []).map((r: any) => ({ startsAt: r.starts_at, endsAt: r.ends_at, spotsLeft: r.spots_left }));
  return { success: true, slots };
}

export async function bookPickupSlot(
  locationId: string,
  startsAtIso: string
): Promise<{ success: boolean; status?: "confirmed" | "held"; expiresAt?: string; error?: string }> {
  if (!UUID_RE.test(locationId)) return { success: false, error: "That pickup location isn't available." };
  const when = new Date(startsAtIso);
  if (Number.isNaN(when.getTime())) return { success: false, error: "Something went wrong. Please try again." };
  const ctx = await getContext();
  if (!ctx) return { success: false, error: "Please sign in again." };

  const { data: held, error: holdError } = await ctx.admin.rpc("hold_pickup_slot", {
    p_rental_id: ctx.rentalId,
    p_customer_id: ctx.customerId,
    p_location_id: locationId,
    p_slot_start: when.toISOString(),
  });
  if (holdError) return { success: false, error: slotErrorMessage(holdError.message) };
  const row = Array.isArray(held) ? held[0] : held;
  if (!row?.out_hold_id) return { success: false, error: "Something went wrong. Please try again." };

  const { data: outcome, error: confirmError } = await ctx.admin.rpc("confirm_pickup_slot", {
    p_hold_id: row.out_hold_id,
    p_customer_id: ctx.customerId,
    p_source: "customer",
  });
  if (confirmError) return { success: false, error: slotErrorMessage(confirmError.message) };

  revalidatePath("/portal/rental");
  if (outcome === "payment_required") return { success: true, status: "held", expiresAt: row.out_expires_at };
  const message = confirmOutcomeMessage(String(outcome));
  if (message) return { success: false, error: message };
  return { success: true, status: "confirmed" };
}

/** Renters can drop a PENDING hold. A confirmed appointment is changed by picking a new time. */
export async function cancelPendingHold(holdId: string): Promise<{ success: boolean; error?: string }> {
  if (!UUID_RE.test(holdId)) return { success: false, error: "Something went wrong. Please try again." };
  const ctx = await getContext();
  if (!ctx) return { success: false, error: "Please sign in again." };

  const { data: hold } = await ctx.admin.from("slot_hold").select("status, customer_id").eq("id", holdId).maybeSingle();
  if (!hold || hold.customer_id !== ctx.customerId || hold.status !== "held") {
    return { success: false, error: "That hold is no longer active." };
  }
  const { error } = await ctx.admin.rpc("release_pickup_slot", { p_hold_id: holdId, p_reason: "customer_released", p_customer_id: ctx.customerId });
  if (error) return { success: false, error: "Something went wrong. Please try again." };
  revalidatePath("/portal/rental");
  return { success: true };
}
