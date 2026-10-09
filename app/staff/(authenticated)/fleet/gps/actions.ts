"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { parseCoordinates } from "@/lib/telematics/status";
import { PROVIDERS, type Provider } from "@/lib/telematics/types";

type Result = { success: boolean; error?: string };

async function tenantId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

function refresh() {
  revalidatePath("/staff/fleet/gps");
  revalidatePath("/staff/fleet/map");
}

export async function addTracker(input: { vehicleId: string; provider: string; externalId: string; nickname: string }): Promise<Result> {
  const supabase = await createClient();
  const tenant = await tenantId(supabase);
  if (!tenant) return { success: false, error: "Something went wrong. Please try again." };

  const provider = input.provider as Provider;
  if (!PROVIDERS.includes(provider) || provider === "manual") return { success: false, error: "Pick a tracker type." };
  const externalId = input.externalId.trim();
  if (!input.vehicleId) return { success: false, error: "Pick a vehicle." };
  if (!externalId) return { success: false, error: provider === "bouncie" ? "Enter the Bouncie device IMEI." : "Enter the tracker’s device ID." };
  if (externalId.length > 64) return { success: false, error: "That device ID is too long." };

  // A vehicle has one active tracker at a time.
  const { data: existing } = await supabase
    .from("telematics_device")
    .select("id")
    .eq("vehicle_id", input.vehicleId)
    .eq("active", true)
    .neq("provider", "manual")
    .limit(1);
  if (existing && existing.length > 0) return { success: false, error: "That vehicle already has a tracker. Remove it first." };

  const { error } = await supabase.from("telematics_device").insert({
    tenant_id: tenant,
    vehicle_id: input.vehicleId,
    provider,
    external_device_id: externalId,
    nickname: input.nickname.trim().slice(0, 60) || null,
  });
  if (error) {
    if (error.code === "23505") return { success: false, error: "That tracker is already added." };
    return { success: false, error: "Couldn’t add that tracker. Please try again." };
  }
  refresh();
  return { success: true };
}

export async function removeTracker(deviceId: string): Promise<Result> {
  const supabase = await createClient();
  // Kept (inactive) rather than deleted, so its history stays attached to the car.
  const { error } = await supabase.from("telematics_device").update({ active: false }).eq("id", deviceId);
  if (error) return { success: false, error: "Couldn’t remove that tracker. Please try again." };
  refresh();
  return { success: true };
}

export async function resolveAlert(alertId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("telematics_alert")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", alertId)
    .eq("status", "open");
  if (error) return { success: false, error: "Couldn’t resolve that alert. Please try again." };
  refresh();
  return { success: true };
}

/** For cars with no working tracker: staff note where the car is. Shows on the map like any other fix. */
export async function logManualLocation(input: { vehicleId: string; coordinates: string }): Promise<Result> {
  const supabase = await createClient();
  const tenant = await tenantId(supabase);
  if (!tenant) return { success: false, error: "Something went wrong. Please try again." };
  if (!input.vehicleId) return { success: false, error: "Pick a vehicle." };
  const coords = parseCoordinates(input.coordinates);
  if (!coords) return { success: false, error: "Enter coordinates like 36.1627, -86.7816 (right-click a spot in Google Maps to copy them)." };

  // Reuse the vehicle's manual "tracker", or create it on first use.
  const { data: found } = await supabase
    .from("telematics_device")
    .select("id")
    .eq("vehicle_id", input.vehicleId)
    .eq("provider", "manual")
    .eq("external_device_id", input.vehicleId)
    .maybeSingle();
  let deviceId = found?.id as string | undefined;
  if (!deviceId) {
    const { data: created, error: createError } = await supabase
      .from("telematics_device")
      .insert({ tenant_id: tenant, vehicle_id: input.vehicleId, provider: "manual", external_device_id: input.vehicleId, nickname: "Manual entry" })
      .select("id")
      .single();
    if (createError || !created) return { success: false, error: "Couldn’t save that location. Please try again." };
    deviceId = created.id;
  }

  const now = new Date().toISOString();
  const { error: eventError } = await supabase.from("telematics_event").insert({
    tenant_id: tenant,
    vehicle_id: input.vehicleId,
    device_id: deviceId,
    event_type: "position",
    occurred_at: now,
    latitude: coords.lat,
    longitude: coords.lng,
    payload: { source: "manual" },
  });
  if (eventError) return { success: false, error: "Couldn’t save that location. Please try again." };

  const { error: cacheError } = await supabase
    .from("telematics_device")
    .update({ last_seen_at: now, last_position_at: now, last_latitude: coords.lat, last_longitude: coords.lng, last_speed: null })
    .eq("id", deviceId);
  if (cacheError) return { success: false, error: "Couldn’t save that location. Please try again." };

  refresh();
  return { success: true };
}
