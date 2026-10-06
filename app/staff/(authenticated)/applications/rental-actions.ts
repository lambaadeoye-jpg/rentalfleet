"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { fireN8nWebhook, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";
import { logAuditEvent } from "@/lib/audit-log";
import { calculateDailyRentalPrice } from "@/lib/pricing";
import { validateRentalWindow, defaultDropoff, isDefaultDropoff } from "@/lib/rental-window";
import { generateAndStoreFinancialDocument } from "@/lib/generate-financial-document";

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

  // Explicit guard, not just reliance on `days` happening to be hardcoded
  // to 7 above. The 7-day minimum is a real, locked business rule (not
  // just marketing copy -- it's stated on the homepage FAQ, but nothing
  // in code actually enforced it before this). If a future change ever
  // turns `days` into a real parameter instead of a constant, this stops
  // a violation at the source rather than relying on the current value
  // never changing by accident.
  if (days < 7) {
    return { success: false, error: "Rentals must be at least 7 days — this is a locked minimum." };
  }

  const quotedAmount = rentalOption === "daily" ? calculateDailyRentalPrice(days, dailyRules) : null;

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

export type PickupLocationOption = { id: string; name: string; address: string };

export async function getPickupLocations(): Promise<PickupLocationOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("location")
    .select("id, name, address_line1, city, state")
    .eq("active", true)
    .order("name");
  return (data ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    address: [l.address_line1, l.city, l.state].filter(Boolean).join(", "),
  }));
}

// ---------------------------------------------------------------------------
// STAFF: set the pickup appointment (time + location) and, optionally, a
// drop-off (return) date for a scheduled rental. With no drop-off given it
// defaults to pickup + 7 days automatically; any other date is a staff
// override (drop_off_manually_set) that pickup confirmation will not
// overwrite. Nothing in the app captured either before:
// scheduleRental used "now" as a placeholder pickup time, no location, and
// a return date fixed at scheduling time + 7 days that ignored when pickup
// actually happens.
//
// Enforces the locked 7-day minimum between pickup and drop-off. Writes
// booking.pickup_at / pickup_location_id / return_at and
// rental.expected_return_at. If the booking was quoted on the daily plan
// (quoted_amount set), the quote is recomputed for the real number of
// days from the admin-editable pricing policy; weekly bookings carry no
// quoted amount, so none is created. Changing the appointment clears
// pickup_confirmed_at: a renter who confirmed the OLD time hasn't
// confirmed this one. Does not touch rental status, vehicle or payments
// (including any payment_schedule due date).
// ---------------------------------------------------------------------------
export async function setPickupAppointment(
  rentalId: string,
  pickupAtIso: string,
  returnAtIso: string | null,
  locationId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const pickupAt = new Date(pickupAtIso);
  if (Number.isNaN(pickupAt.getTime())) return { success: false, error: "Enter a valid pickup date and time." };
  // Drop-off defaults to pickup + 7 days automatically; staff may override.
  const returnAt = returnAtIso ? new Date(returnAtIso) : defaultDropoff(pickupAt);
  if (pickupAt.getTime() < Date.now() - 5 * 60 * 1000) return { success: false, error: "Pickup time can't be in the past." };
  if (!locationId) return { success: false, error: "Choose a pickup location." };

  const window = validateRentalWindow(pickupAt, returnAt);
  if (!window.ok) return { success: false, error: window.error };

  const { data: rental } = await supabase
    .from("rental")
    .select("id, status, booking_id, tenant_id")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) return { success: false, error: "Rental not found." };
  if (rental.status !== "scheduled") return { success: false, error: "Only a scheduled rental can have its appointment changed." };
  if (!rental.booking_id) return { success: false, error: "This rental has no booking to attach the appointment to." };

  const { data: booking } = await supabase
    .from("booking")
    .select("id, quoted_amount")
    .eq("id", rental.booking_id)
    .maybeSingle();
  if (!booking) return { success: false, error: "Booking not found." };

  const bookingUpdate: Record<string, unknown> = {
    pickup_at: pickupAt.toISOString(),
    pickup_location_id: locationId,
    return_at: returnAt.toISOString(),
  };

  // Daily-plan bookings were quoted for a fixed 7 days at scheduling time.
  // Re-quote for the real window so the stored amount can't be stale.
  if (booking.quoted_amount !== null) {
    const { data: policy } = await supabase
      .from("policy_version")
      .select("rules")
      .eq("tenant_id", rental.tenant_id)
      .eq("policy_type", "pricing_and_mileage")
      .maybeSingle();
    const requoted = calculateDailyRentalPrice(window.days, (policy?.rules as any)?.daily);
    if (requoted !== null) bookingUpdate.quoted_amount = requoted;
  }

  const { error: bookingError } = await supabase.from("booking").update(bookingUpdate).eq("id", booking.id);
  if (bookingError) {
    const msg = bookingError.message?.toLowerCase().includes("permission")
      ? "You don't have permission to set the appointment."
      : "Couldn't save the appointment. Please try again.";
    return { success: false, error: msg };
  }

  const { error: rentalError } = await supabase
    .from("rental")
    .update({
      expected_return_at: returnAt.toISOString(),
      drop_off_manually_set: !isDefaultDropoff(pickupAt, returnAt),
      pickup_confirmed_at: null,
    })
    .eq("id", rentalId);
  if (rentalError) return { success: false, error: "Saved the pickup time but couldn't save the drop-off date. Please try again." };

  revalidatePath("/staff/pickups");
  return { success: true };
}

// ---------------------------------------------------------------------------
// STAFF: change a rental's drop-off date at ANY time before it is returned
// (scheduled, active, extended, ...). Counted from the real pickup moment
// once the rental has started, otherwise from the planned appointment.
// Enforces the locked 7-day minimum. Always marks the date as a staff
// choice so automatic recomputation never overwrites it. While still
// scheduled, daily-plan quotes are re-quoted for the new length; once a
// rental is active the stored quote is left alone (money may already have
// been collected against it -- billing changes for extensions belong with
// the payment processor work, not a silent edit here). Does not touch any
// payment_schedule due date. Writes an audit event with before/after.
// ---------------------------------------------------------------------------
const DROPOFF_EDITABLE_STATUSES = ["scheduled", "active", "extended", "return_pending", "delinquent", "suspended"];

export async function setDropoffDate(
  rentalId: string,
  returnAtIso: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const returnAt = new Date(returnAtIso);
  if (Number.isNaN(returnAt.getTime())) return { success: false, error: "Enter a valid drop-off date and time." };

  const { data: rental } = await supabase
    .from("rental")
    .select("id, tenant_id, status, start_at, actual_return_at, expected_return_at, booking_id")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) return { success: false, error: "Rental not found." };
  if (rental.actual_return_at || !DROPOFF_EDITABLE_STATUSES.includes(rental.status)) {
    return { success: false, error: "This rental is no longer open, so its drop-off date can't be changed." };
  }

  const { data: booking } = rental.booking_id
    ? await supabase.from("booking").select("id, pickup_at, quoted_amount").eq("id", rental.booking_id).maybeSingle()
    : { data: null };

  const basisIso = rental.start_at ?? booking?.pickup_at;
  if (!basisIso) return { success: false, error: "This rental has no pickup time yet. Set the pickup appointment first." };

  const window = validateRentalWindow(new Date(basisIso), returnAt);
  if (!window.ok) return { success: false, error: window.error };

  if (booking) {
    const bookingUpdate: Record<string, unknown> = { return_at: returnAt.toISOString() };
    if (rental.status === "scheduled" && booking.quoted_amount !== null) {
      const { data: policy } = await supabase
        .from("policy_version")
        .select("rules")
        .eq("tenant_id", rental.tenant_id)
        .eq("policy_type", "pricing_and_mileage")
        .maybeSingle();
      const requoted = calculateDailyRentalPrice(window.days, (policy?.rules as any)?.daily);
      if (requoted !== null) bookingUpdate.quoted_amount = requoted;
    }
    const { error: bookingError } = await supabase.from("booking").update(bookingUpdate).eq("id", booking.id);
    if (bookingError) {
      const msg = bookingError.message?.toLowerCase().includes("permission")
        ? "You don't have permission to change the drop-off date."
        : "Couldn't save the drop-off date. Please try again.";
      return { success: false, error: msg };
    }
  }

  const { error: rentalError } = await supabase
    .from("rental")
    .update({ expected_return_at: returnAt.toISOString(), drop_off_manually_set: true })
    .eq("id", rentalId);
  if (rentalError) return { success: false, error: "Couldn't save the drop-off date. Please try again." };

  await logAuditEvent({
    tenantId: rental.tenant_id,
    action: "rental.dropoff_date_changed",
    entityType: "rental",
    entityId: rentalId,
    beforeData: { expected_return_at: rental.expected_return_at },
    afterData: { expected_return_at: returnAt.toISOString() },
    source: "staff",
  });

  revalidatePath("/staff/pickups");
  return { success: true };
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
    .select("id, tenant_id, customer_id, status, booking_id, expected_return_at, drop_off_manually_set, rental_segment(id, vehicle_id)")
    .eq("id", rentalId)
    .single();

  if (!rental) return { success: false, error: "Rental not found." };
  if (rental.status !== "scheduled") return { success: false, error: "This rental isn't in scheduled status." };

  const segment = (rental.rental_segment as any)?.[0];
  if (!segment) return { success: false, error: "No vehicle assigned to this rental." };

  // Real gap closed here: previously nothing required a payment/deposit
  // to be collected before pickup could be confirmed. Requiring at least
  // one recorded payment (any amount, any method) -- there's no dedicated
  // "collect deposit" action separate from recordPayment() yet, so this
  // is the honest, buildable version of that check with what actually
  // exists today.
  const { count: paymentCount } = await supabase
    .from("payment")
    .select("id", { count: "exact", head: true })
    .eq("rental_id", rentalId);

  if (!paymentCount || paymentCount === 0) {
    return { success: false, error: "Record a payment/deposit before confirming pickup." };
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();

  // Drop-off: automatic (actual pickup + 7 days) unless staff set it by hand.
  // A staff-set date is never silently overwritten; if the pickup happens so
  // late that it would fall under the 7-day minimum, staff must fix it first.
  let expectedReturnAt: string;
  if (rental.drop_off_manually_set && rental.expected_return_at) {
    const check = validateRentalWindow(nowDate, new Date(rental.expected_return_at));
    if (!check.ok) {
      return { success: false, error: "The drop-off date staff set is now less than 7 days from pickup. Update the drop-off date, then confirm pickup." };
    }
    expectedReturnAt = rental.expected_return_at;
  } else {
    expectedReturnAt = defaultDropoff(nowDate).toISOString();
  }

  const { error: rentalUpdateError } = await supabase
    .from("rental")
    .update({
      status: "active",
      start_at: now,
      expected_return_at: expectedReturnAt,
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

  if (rental.booking_id) {
    await supabase.from("booking").update({ return_at: expectedReturnAt }).eq("id", rental.booking_id);
  }

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

  void logAuditEvent({
    tenantId: rental.tenant_id,
    action: "rental_pickup_confirmed",
    entityType: "rental",
    entityId: rentalId,
    afterData: { startMileage, vehicleId: segment.vehicle_id },
    source: "staff_portal",
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
    .select("id, tenant_id, status, rental_segment(id, vehicle_id)")
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

  void logAuditEvent({
    tenantId: rental.tenant_id,
    action: "rental_dropoff_confirmed",
    entityType: "rental",
    entityId: rentalId,
    afterData: { endMileage, vehicleId: segment.vehicle_id },
    source: "staff_portal",
  });

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

  const { data: payment, error } = await supabase
    .from("payment")
    .insert({
      tenant_id: rental.tenant_id,
      rental_id: rental.id,
      customer_id: rental.customer_id,
      method_type: methodType,
      amount,
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    const msg = error.message?.toLowerCase().includes("permission")
      ? "You don't have permission to record a payment."
      : "Couldn't record that payment. Please try again.";
    return { success: false, error: msg };
  }

  revalidatePath("/staff/fleet");

  if (payment) {
    void logAuditEvent({
      tenantId: rental.tenant_id,
      action: "payment_recorded",
      entityType: "payment",
      entityId: payment.id,
      afterData: { amount, methodType, rentalId },
      source: "staff_portal",
    });

    // Best-effort, same discipline as everything else fired off the
    // back of a successful write in this build: a receipt failing to
    // generate must never undo or block the payment that was just
    // recorded.
    void generateAndStoreFinancialDocument({
      documentType: "receipt",
      rentalId,
      customerId: rental.customer_id,
      amount,
      lineLabel: `Payment received (${methodType})`,
      relatedPaymentId: payment.id,
    });
  }

  return { success: true };
}
