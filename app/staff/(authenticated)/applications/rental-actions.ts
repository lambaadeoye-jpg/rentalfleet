"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { fireN8nWebhook, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";

export type AvailableVehicle = {
  id: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
};

export async function getAvailableVehicles(): Promise<AvailableVehicle[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vehicle")
    .select("id, vin, make, model, year")
    .eq("status", "available")
    .order("created_at");
  return data ?? [];
}

// ---------------------------------------------------------------------------
// OFFICE: schedule a rental for an approved application. Ends at
// 'scheduled' -- deliberately does NOT hand over the vehicle. That's a
// separate action (confirmPickup, below) for a reason: the person
// physically handing over keys may be a different, more junior person
// than whoever manages applications and fleet status. This function needs
// assign_vehicle (picking which car) and the vehicle available->reserved
// transition needs manage_fleet -- both office-level permissions.
// Deliberately does NOT touch customer.status or fire the review webhook;
// both happen at actual pickup, not at scheduling.
// ---------------------------------------------------------------------------
export async function scheduleRental(
  applicationId: string,
  vehicleId: string,
  rentalOption: "daily" | "weekly"
): Promise<{ success: boolean; error?: string; rentalId?: string }> {
  const supabase = await createClient();

  const { data: application } = await supabase
    .from("application")
    .select("id, tenant_id, customer_id, status")
    .eq("id", applicationId)
    .single();

  if (!application) return { success: false, error: "Application not found." };
  if (application.status !== "approved" && application.status !== "conditionally_approved") {
    return { success: false, error: "Only approved applications can be scheduled for a rental." };
  }

  const { data: vehicle } = await supabase
    .from("vehicle")
    .select("id, category_id, status")
    .eq("id", vehicleId)
    .single();

  if (!vehicle) return { success: false, error: "Vehicle not found." };
  if (vehicle.status !== "available") return { success: false, error: "That vehicle is no longer available." };

  const { data: channel } = await supabase
    .from("booking_channel")
    .select("id")
    .eq("tenant_id", application.tenant_id)
    .eq("code", "direct")
    .maybeSingle();

  // Reads pricing from the admin-editable policy (migration 0038) instead
  // of hardcoding it -- an admin changing rates on /staff/pricing actually
  // takes effect here.
  const { data: policy } = await supabase
    .from("policy_version")
    .select("rules")
    .eq("tenant_id", application.tenant_id)
    .eq("policy_type", "pricing_and_mileage")
    .maybeSingle();

  const rules = (policy?.rules as any) ?? {};
  const dailyRules = rules.daily;
  const days = 7;

  let quotedAmount: number | null = null;
  if (rentalOption === "daily" && dailyRules?.approved) {
    const extraDays = days - dailyRules.first_tier_days;
    quotedAmount = dailyRules.first_tier_total_usd + Math.max(0, extraDays) * dailyRules.per_day_after_usd;
  }

  const plannedPickupAt = new Date();
  const plannedReturnAt = new Date(plannedPickupAt.getTime() + days * 24 * 60 * 60 * 1000);

  const { data: booking, error: bookingError } = await supabase
    .from("booking")
    .insert({
      tenant_id: application.tenant_id,
      customer_id: application.customer_id,
      category_id: vehicle.category_id,
      channel_id: channel?.id ?? null,
      pickup_at: plannedPickupAt.toISOString(),
      return_at: plannedReturnAt.toISOString(),
      status: "confirmed",
      quoted_amount: quotedAmount,
    })
    .select("id")
    .single();

  if (bookingError || !booking) return { success: false, error: "Couldn't create the booking. Please try again." };

  const { data: rental, error: rentalError } = await supabase
    .from("rental")
    .insert({
      tenant_id: application.tenant_id,
      customer_id: application.customer_id,
      booking_id: booking.id,
      status: "pending",
      expected_return_at: plannedReturnAt.toISOString(),
      governing_policy_snapshot: policy?.rules ?? {},
    })
    .select("id")
    .single();

  if (rentalError || !rental) return { success: false, error: "Couldn't create the rental. Please try again." };

  for (const status of ["approved", "scheduled"] as const) {
    const { error } = await supabase.from("rental").update({ status }).eq("id", rental.id);
    if (error) {
      const msg = error.message?.toLowerCase().includes("permission")
        ? "You don't have permission to schedule a rental."
        : `Couldn't move the rental to "${status}".`;
      return { success: false, error: msg };
    }
  }

  const { error: segmentError } = await supabase.from("rental_segment").insert({
    tenant_id: application.tenant_id,
    rental_id: rental.id,
    vehicle_id: vehicleId,
    starts_at: plannedPickupAt.toISOString(),
  });
  if (segmentError) {
    const msg = segmentError.message?.toLowerCase().includes("permission")
      ? "You don't have permission to assign a vehicle."
      : "Couldn't assign the vehicle. Please try again.";
    return { success: false, error: msg };
  }

  const { error: vehicleError } = await supabase.from("vehicle").update({ status: "reserved" }).eq("id", vehicleId);
  if (vehicleError) {
    const msg = vehicleError.message?.toLowerCase().includes("permission")
      ? "You don't have permission to update vehicle status."
      : "Couldn't reserve the vehicle.";
    return { success: false, error: msg };
  }

  // Weekly payment schedule only created when explicitly approved (0038)
  // -- fixed a real bug where an unapproved draft rate would have been
  // silently used otherwise.
  if (rules.weekly_approved && rules.weekly_rate_usd) {
    await supabase.from("payment_schedule").insert({
      tenant_id: application.tenant_id,
      rental_id: rental.id,
      cadence: "weekly",
      next_due_at: plannedReturnAt.toISOString(),
      amount: rules.weekly_rate_usd,
      status: "active",
    });
  }

  revalidatePath(`/staff/applications/${applicationId}`);
  return { success: true, rentalId: rental.id };
}

export type ActiveRentalInfo = {
  id: string;
  status: string;
  customerId: string;
  customerFirstName: string;
  customerPhone: string;
  customerEmail: string;
  vehicleId: string;
  vehicleLabel: string;
  hasLicenseDocument: boolean;
  insuranceVerified: boolean;
  agreementAcknowledgedAt: string | null;
  pickupChecklistCompletedAt: string | null;
  dropoffChecklistCompletedAt: string | null;
};

// Real, data-backed checklist state for a scheduled/active rental -- used
// by the pickup/dropoff panel. Three checks are genuinely backed by real
// data (license document exists, insurance verification status, vehicle
// status); agreement acknowledgment is an honest lightweight placeholder,
// not a real e-signature (none exists yet).
export async function getRentalForChecklist(rentalId: string): Promise<ActiveRentalInfo | null> {
  const supabase = await createClient();

  const { data: rental } = await supabase
    .from("rental")
    .select(
      "id, status, customer_id, agreement_acknowledged_at, pickup_checklist_completed_at, dropoff_checklist_completed_at, customer:customer_id(first_name, phone, email), rental_segment(vehicle_id, vehicle:vehicle_id(make, model, year))"
    )
    .eq("id", rentalId)
    .maybeSingle();

  if (!rental) return null;

  const customer = rental.customer as any;
  const segment = (rental.rental_segment as any)?.[0];
  const vehicle = segment?.vehicle;

  const [{ count: docCount }, { data: insurance }] = await Promise.all([
    supabase
      .from("customer_document")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", rental.customer_id)
      .eq("document_type", "drivers_license"),
    supabase
      .from("insurance_policy")
      .select("verification_status")
      .eq("customer_id", rental.customer_id)
      .eq("policy_type", "renter")
      .maybeSingle(),
  ]);

  return {
    id: rental.id,
    status: rental.status,
    customerId: rental.customer_id,
    customerFirstName: customer?.first_name ?? "",
    customerPhone: customer?.phone ?? "",
    customerEmail: customer?.email ?? "",
    vehicleId: segment?.vehicle_id ?? "",
    vehicleLabel: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "",
    hasLicenseDocument: (docCount ?? 0) > 0,
    insuranceVerified: insurance?.verification_status === "verified_active" || insurance?.verification_status === "expiring_soon",
    agreementAcknowledgedAt: rental.agreement_acknowledged_at,
    pickupChecklistCompletedAt: rental.pickup_checklist_completed_at,
    dropoffChecklistCompletedAt: rental.dropoff_checklist_completed_at,
  };
}

// ---------------------------------------------------------------------------
// FIELD: confirm actual physical pickup. This is the moment start_mileage
// gets recorded, the agreement gets acknowledged, and the rental actually
// becomes active. Requires start_rental (the existing transition gate) --
// granted to both admin and the new field_staff role (migration 0037).
// ---------------------------------------------------------------------------
export async function confirmPickup(
  rentalId: string,
  startMileage: number,
  agreementAcknowledged: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!agreementAcknowledged) {
    return { success: false, error: "Confirm the agreement was walked through before completing pickup." };
  }

  const supabase = await createClient();

  const { data: rental } = await supabase
    .from("rental")
    .select("id, tenant_id, customer_id, status, rental_segment(id, vehicle_id)")
    .eq("id", rentalId)
    .single();

  if (!rental) return { success: false, error: "Rental not found." };
  if (rental.status !== "scheduled") return { success: false, error: "This rental isn't in scheduled status." };

  const segment = (rental.rental_segment as any)?.[0];
  if (!segment) return { success: false, error: "No vehicle assigned to this rental." };

  const now = new Date().toISOString();

  const { error: rentalUpdateError } = await supabase
    .from("rental")
    .update({
      status: "active",
      start_at: now,
      agreement_acknowledged_at: now,
      pickup_checklist_completed_at: now,
    })
    .eq("id", rentalId);

  if (rentalUpdateError) {
    const msg = rentalUpdateError.message?.toLowerCase().includes("permission")
      ? "You don't have permission to confirm pickup."
      : rentalUpdateError.message?.toLowerCase().includes("renter insurance is not verified")
        ? "This customer's insurance isn't verified as active yet."
        : "Couldn't confirm pickup. Please try again.";
    return { success: false, error: msg };
  }

  await supabase.from("rental_segment").update({ start_mileage: startMileage }).eq("id", segment.id);

  const { error: vehicleError } = await supabase
    .from("vehicle")
    .update({ status: "rented" })
    .eq("id", segment.vehicle_id);
  if (vehicleError) {
    const msg = vehicleError.message?.toLowerCase().includes("permission")
      ? "You don't have permission to mark the vehicle rented."
      : "Couldn't update the vehicle.";
    return { success: false, error: msg };
  }

  await supabase.from("customer").update({ status: "active" }).eq("id", rental.customer_id);

  revalidatePath("/staff/fleet");

  // Fire-and-forget the review-request webhook, now carrying the current
  // Google review link + Facebook ad URL from tenant_setting instead of
  // requiring anyone to edit the n8n workflow directly when a new ad
  // campaign starts.
  const [{ data: customer }, { data: settings }] = await Promise.all([
    supabase.from("customer").select("first_name, phone, email").eq("id", rental.customer_id).maybeSingle(),
    supabase.from("tenant_setting").select("key, value").in("key", ["google_review_url", "facebook_ad_url"]),
  ]);

  const settingsMap = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]));

  void fireN8nWebhook(N8N_WEBHOOK_PATHS.pickupReviewRequest, {
    rentalId: rental.id,
    customerFirstName: customer?.first_name ?? null,
    customerPhone: customer?.phone ?? null,
    customerEmail: customer?.email ?? null,
    googleReviewUrl: settingsMap.google_review_url ?? null,
    facebookAdUrl: settingsMap.facebook_ad_url ?? null,
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// FIELD: confirm dropoff/return. Walks the already-seeded return path
// (active -> return_pending -> returned -> closed) in one action, records
// actual_return_at and end_mileage, frees the vehicle back to available.
// Requires confirm_dropoff.
// ---------------------------------------------------------------------------
export async function confirmDropoff(
  rentalId: string,
  endMileage: number
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: rental } = await supabase
    .from("rental")
    .select("id, status, rental_segment(id, vehicle_id)")
    .eq("id", rentalId)
    .single();

  if (!rental) return { success: false, error: "Rental not found." };
  if (rental.status !== "active") return { success: false, error: "This rental isn't currently active." };

  const segment = (rental.rental_segment as any)?.[0];
  if (!segment) return { success: false, error: "No vehicle assigned to this rental." };

  const now = new Date().toISOString();

  for (const status of ["return_pending", "returned", "closed"] as const) {
    const { error } = await supabase.from("rental").update({ status }).eq("id", rentalId);
    if (error) {
      const msg = error.message?.toLowerCase().includes("permission")
        ? "You don't have permission to confirm dropoff."
        : `Couldn't move the rental to "${status}".`;
      return { success: false, error: msg };
    }
  }

  await supabase
    .from("rental")
    .update({ actual_return_at: now, dropoff_checklist_completed_at: now })
    .eq("id", rentalId);

  await supabase.from("rental_segment").update({ end_mileage: endMileage, ends_at: now }).eq("id", segment.id);

  const { error: vehicleError } = await supabase
    .from("vehicle")
    .update({ status: "available" })
    .eq("id", segment.vehicle_id);
  if (vehicleError) {
    const msg = vehicleError.message?.toLowerCase().includes("permission")
      ? "You don't have permission to free up the vehicle."
      : "Couldn't update the vehicle.";
    return { success: false, error: msg };
  }

  revalidatePath("/staff/fleet");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Manual payment recording. Requires collect_payment (migration 0037) --
// previously payment had no permission gate at all.
// ---------------------------------------------------------------------------
export async function recordPayment(
  rentalId: string,
  amount: number,
  methodType: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: rental } = await supabase.from("rental").select("id, tenant_id, customer_id").eq("id", rentalId).single();
  if (!rental) return { success: false, error: "Rental not found." };

  const { error } = await supabase.from("payment").insert({
    tenant_id: rental.tenant_id,
    rental_id: rental.id,
    customer_id: rental.customer_id,
    method_type: methodType,
    amount,
    status: "paid",
    paid_at: new Date().toISOString(),
  });

  if (error) {
    const msg = error.message?.toLowerCase().includes("permission")
      ? "You don't have permission to record a payment."
      : "Couldn't record that payment. Please try again.";
    return { success: false, error: msg };
  }

  revalidatePath("/staff/fleet");
  return { success: true };
}
