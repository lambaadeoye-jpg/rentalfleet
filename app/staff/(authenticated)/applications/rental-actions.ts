"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit-log";
import { currentRoleName, currentUser } from "@/lib/staff-role";
import { handoverMissing, validMileage } from "@/lib/handover";
import { loadHandoverState, loadRuleValues, toHandoverState } from "@/lib/handover-server";
import { briefingRules } from "@/lib/rental-rules";
import { sendPostPickupMessage } from "@/lib/post-pickup";
import { agreementAllowsHandover } from "@/lib/runner-access";
import { calculateDailyRentalPrice } from "@/lib/pricing";
import { validateRentalWindow, defaultDropoff, isDefaultDropoff } from "@/lib/rental-window";
import { computeWeeklyRate, computeDailyTotal, resolveDeposit, ACCEPTED_PAYMENT_METHODS, type InsuranceArrangement } from "@/lib/rental-rate";
import { generateAndStoreFinancialDocument } from "@/lib/generate-financial-document";

// Daily-plan total for a window, adjusted for the renter’s insurance
// arrangement. Legacy rentals (no arrangement recorded) keep the standard
// price. Returns null when the daily price can’t be computed.
async function requoteDaily(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  billableDays: number,
  arrangement: InsuranceArrangement | null
): Promise<number | null> {
  const { data: policy } = await supabase
    .from("policy_version")
    .select("rules")
    .eq("tenant_id", tenantId)
    .eq("policy_type", "pricing_and_mileage")
    .maybeSingle();
  const rules = (policy?.rules as any) ?? {};
  const standard = calculateDailyRentalPrice(billableDays, rules.daily);
  if (standard === null) return null;
  if (!arrangement) return standard;
  const adjusted = computeDailyTotal(standard, billableDays, arrangement, rules.insurance);
  return adjusted.ok ? adjusted.amount : null;
}

export type RatePreview =
  | { ok: true; rent: number; base: number; deposit: number; perLabel: string }
  | { ok: false; error: string };

// Staff-only preview shown on the Schedule Rental form so the number is
// seen before it is locked in. Same calculation scheduleRental uses.
export async function previewRentalRate(
  rentalOption: "daily" | "weekly",
  arrangement: InsuranceArrangement
): Promise<RatePreview> {
  const supabase = await createClient();
  const { data: policy } = await supabase
    .from("policy_version")
    .select("rules")
    .eq("policy_type", "pricing_and_mileage")
    .eq("immutable", false)
    .maybeSingle();
  const rules = (policy?.rules as any) ?? {};

  const deposit = resolveDeposit(rules.deposit);
  if (!deposit.ok) return { ok: false, error: deposit.error };

  if (rentalOption === "weekly") {
    if (!rules.weekly_approved || !rules.weekly_rate_usd) return { ok: false, error: "Weekly pricing isn’t approved on the Pricing page." };
    const w = computeWeeklyRate(rules.weekly_rate_usd, arrangement, rules.insurance);
    return w.ok ? { ok: true, rent: w.amount, base: w.base, deposit: deposit.amount, perLabel: "per week" } : { ok: false, error: w.error };
  }
  const standard = calculateDailyRentalPrice(7, rules.daily);
  if (standard === null) return { ok: false, error: "Daily pricing isn’t approved on the Pricing page." };
  const d = computeDailyTotal(standard, 7, arrangement, rules.insurance);
  return d.ok ? { ok: true, rent: d.amount, base: d.base, deposit: deposit.amount, perLabel: "for the first 7 days" } : { ok: false, error: d.error };
}

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
// 'scheduled' -- deliberately does NOT hand over the vehicle. That’s a
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
  rentalOption: "daily" | "weekly",
  insuranceArrangement?: InsuranceArrangement
): Promise<{ success: boolean; error?: string; rentalId?: string }> {
  const supabase = await createClient();
  if ((await currentRoleName(supabase)) === "field_staff") return { success: false, error: OFFICE_ONLY } as any;

  const { data: application } = await supabase
    .from("application")
    .select("id, tenant_id, customer_id, status, has_own_insurance")
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
  // just marketing copy -- it’s stated on the homepage FAQ, but nothing
  // in code actually enforced it before this). If a future change ever
  // turns `days` into a real parameter instead of a constant, this stops
  // a violation at the source rather than relying on the current value
  // never changing by accident.
  if (days < 7) {
    return { success: false, error: "Rentals must be at least 7 days — this is a locked minimum." };
  }

  // Insurance arrangement: staff may choose, otherwise it follows the
  // renter’s own answer on the application. Never guessed.
  const arrangement: InsuranceArrangement | null =
    insuranceArrangement ??
    (application.has_own_insurance === true ? "own" : application.has_own_insurance === false ? "via_provider" : null);
  if (!arrangement) {
    return { success: false, error: "Choose whether this renter has their own insurance before scheduling." };
  }

  const deposit = resolveDeposit(rules.deposit);
  if (!deposit.ok) return { success: false, error: deposit.error };

  let quotedAmount: number | null = null;
  let agreedWeeklyRate: number | null = null;
  if (rentalOption === "daily") {
    const standard = calculateDailyRentalPrice(days, dailyRules);
    if (standard === null) return { success: false, error: "Daily pricing isn’t approved on the Pricing page." };
    const adjusted = computeDailyTotal(standard, days, arrangement, rules.insurance);
    if (!adjusted.ok) return { success: false, error: adjusted.error };
    quotedAmount = adjusted.amount;
  } else {
    if (!rules.weekly_approved || !rules.weekly_rate_usd) {
      return { success: false, error: "Weekly pricing isn’t approved on the Pricing page." };
    }
    const weekly = computeWeeklyRate(rules.weekly_rate_usd, arrangement, rules.insurance);
    if (!weekly.ok) return { success: false, error: weekly.error };
    agreedWeeklyRate = weekly.amount;
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

  if (bookingError || !booking) return { success: false, error: "Couldn’t create the booking. Please try again." };

  const { data: rental, error: rentalError } = await supabase
    .from("rental")
    .insert({
      tenant_id: application.tenant_id,
      customer_id: application.customer_id,
      booking_id: booking.id,
      status: "pending",
      expected_return_at: plannedReturnAt.toISOString(),
      governing_policy_snapshot: policy?.rules ?? {},
      insurance_arrangement: arrangement,
      agreed_weekly_rate_usd: agreedWeeklyRate,
      deposit_required_usd: deposit.amount,
    })
    .select("id")
    .single();

  if (rentalError || !rental) return { success: false, error: "Couldn’t create the rental. Please try again." };

  for (const status of ["approved", "scheduled"] as const) {
    const { error } = await supabase.from("rental").update({ status }).eq("id", rental.id);
    if (error) {
      const msg = error.message?.toLowerCase().includes("permission")
        ? "You don’t have permission to schedule a rental."
        : `Couldn’t move the rental to "${status}".`;
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
      ? "You don’t have permission to assign a vehicle."
      : "Couldn’t assign the vehicle. Please try again.";
    return { success: false, error: msg };
  }

  const { error: vehicleError } = await supabase.from("vehicle").update({ status: "reserved" }).eq("id", vehicleId);
  if (vehicleError) {
    const msg = vehicleError.message?.toLowerCase().includes("permission")
      ? "You don’t have permission to update vehicle status."
      : "Couldn’t reserve the vehicle.";
    return { success: false, error: msg };
  }

  // Weekly payment schedule only created when explicitly approved (0038)
  // -- fixed a real bug where an unapproved draft rate would have been
  // silently used otherwise.
  if (agreedWeeklyRate !== null) {
    await supabase.from("payment_schedule").insert({
      tenant_id: application.tenant_id,
      rental_id: rental.id,
      cadence: "weekly",
      next_due_at: plannedReturnAt.toISOString(),
      amount: agreedWeeklyRate,
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
// pickup_confirmed_at: a renter who confirmed the OLD time hasn’t
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
  if ((await currentRoleName(supabase)) === "field_staff") return { success: false, error: OFFICE_ONLY } as any;

  const pickupAt = new Date(pickupAtIso);
  if (Number.isNaN(pickupAt.getTime())) return { success: false, error: "Enter a valid pickup date and time." };
  // Drop-off defaults to pickup + 7 days automatically; staff may override.
  const returnAt = returnAtIso ? new Date(returnAtIso) : defaultDropoff(pickupAt);
  if (pickupAt.getTime() < Date.now() - 5 * 60 * 1000) return { success: false, error: "Pickup time can’t be in the past." };
  if (!locationId) return { success: false, error: "Choose a pickup location." };

  const window = validateRentalWindow(pickupAt, returnAt);
  if (!window.ok) return { success: false, error: window.error };

  const { data: rental } = await supabase
    .from("rental")
    .select("id, status, booking_id, tenant_id, insurance_arrangement")
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
  // Re-quote for the real window (with the renter’s insurance arrangement)
  // so the stored amount can’t be stale.
  if (booking.quoted_amount !== null) {
    const requoted = await requoteDaily(supabase, rental.tenant_id, window.days, (rental as any).insurance_arrangement ?? null);
    if (requoted !== null) bookingUpdate.quoted_amount = requoted;
  }

  const { error: bookingError } = await supabase.from("booking").update(bookingUpdate).eq("id", booking.id);
  if (bookingError) {
    const msg = bookingError.message?.toLowerCase().includes("permission")
      ? "You don’t have permission to set the appointment."
      : "Couldn’t save the appointment. Please try again.";
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
  if (rentalError) return { success: false, error: "Saved the pickup time but couldn’t save the drop-off date. Please try again." };

  revalidatePath("/staff/pickups");
  return { success: true };
}

// ---------------------------------------------------------------------------
// STAFF: change a rental’s drop-off date at ANY time before it is returned
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
  if ((await currentRoleName(supabase)) === "field_staff") return { success: false, error: OFFICE_ONLY } as any;

  const returnAt = new Date(returnAtIso);
  if (Number.isNaN(returnAt.getTime())) return { success: false, error: "Enter a valid drop-off date and time." };

  const { data: rental } = await supabase
    .from("rental")
    .select("id, tenant_id, status, start_at, actual_return_at, expected_return_at, booking_id, insurance_arrangement")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) return { success: false, error: "Rental not found." };
  if (rental.actual_return_at || !DROPOFF_EDITABLE_STATUSES.includes(rental.status)) {
    return { success: false, error: "This rental is no longer open, so its drop-off date can’t be changed." };
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
      const requoted = await requoteDaily(supabase, rental.tenant_id, window.days, (rental as any).insurance_arrangement ?? null);
      if (requoted !== null) bookingUpdate.quoted_amount = requoted;
    }
    const { error: bookingError } = await supabase.from("booking").update(bookingUpdate).eq("id", booking.id);
    if (bookingError) {
      const msg = bookingError.message?.toLowerCase().includes("permission")
        ? "You don’t have permission to change the drop-off date."
        : "Couldn’t save the drop-off date. Please try again.";
      return { success: false, error: msg };
    }
  }

  const { error: rentalError } = await supabase
    .from("rental")
    .update({ expected_return_at: returnAt.toISOString(), drop_off_manually_set: true })
    .eq("id", rentalId);
  if (rentalError) return { success: false, error: "Couldn’t save the drop-off date. Please try again." };

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
// Runners (field_staff) can see a rental but not change its terms, schedule or money.
const OFFICE_ONLY = "Only the office can do this.";

// FIELD: confirm actual physical pickup. This is the moment start_mileage
// gets recorded, the agreement gets acknowledged, and the rental actually
// becomes active. Requires start_rental (the existing transition gate) --
// granted to both admin and the new field_staff role (migration 0037).
// ---------------------------------------------------------------------------
export async function confirmPickup(
  rentalId: string,
  startMileage: number,
  agreementAcknowledged: boolean
): Promise<{ success: boolean; error?: string; rulesSent?: boolean; rulesNote?: string }> {
  if (!agreementAcknowledged) {
    return { success: false, error: "Confirm the agreement was walked through before completing pickup." };
  }

  const supabase = await createClient();

  const { data: rental } = await supabase
    .from("rental")
    .select("id, tenant_id, customer_id, status, booking_id, expected_return_at, drop_off_manually_set, assigned_runner_id, pickup_checklist_completed_at, rental_segment(id, vehicle_id)")
    .eq("id", rentalId)
    .single();

  if (!rental) return { success: false, error: "Rental not found." };

  // A runner can only hand over a rental assigned to them.
  const me = await currentUser(supabase);
  if (me?.role === "field_staff" && rental.assigned_runner_id !== me.id) {
    return { success: false, error: "This pickup isn’t assigned to you." };
  }

  // Resume: the rental went active but a later step failed last time (for example the
  // vehicle update after a dropped signal). Finish the remaining steps instead of leaving it stuck.
  if (rental.status === "active" && rental.pickup_checklist_completed_at && Date.now() - new Date(rental.pickup_checklist_completed_at).getTime() < 60 * 60 * 1000) {
    const resumeSegment = (rental.rental_segment as any)?.[0];
    if (resumeSegment) {
      const { error: resumeVehicleError } = await supabase.from("vehicle").update({ status: "rented" }).eq("id", resumeSegment.vehicle_id);
      if (resumeVehicleError && !/transition|already/i.test(resumeVehicleError.message ?? "")) {
        return { success: false, error: "The rental is active but the car’s status couldn’t be updated. Try again, or tell the office." };
      }
      await supabase.from("customer").update({ status: "active" }).eq("id", rental.customer_id);
      const resumed = await sendPostPickupMessage(rental.id);
      revalidatePath("/staff/fleet");
      return { success: true, rulesSent: resumed.sms === "sent" || resumed.email === "sent" || resumed.reasons.includes("already_sent") };
    }
  }

  if (rental.status !== "scheduled") return { success: false, error: "This rental isn’t in scheduled status." };

  // A runner may not hand over keys until the renter has signed the agreement. The office is trusted to judge older rentals.
  if ((await currentRoleName(supabase)) === "field_staff") {
    const { count: signedCount } = await supabase
      .from("signed_document")
      .select("id", { count: "exact", head: true })
      .eq("rental_id", rentalId)
      .not("sign_request_id", "is", null);
    const gate = agreementAllowsHandover({ signed: (signedCount ?? 0) > 0 });
    if (!gate.ok) return { success: false, error: gate.message };
  }

  const segment = (rental.rental_segment as any)?.[0];
  if (!segment) return { success: false, error: "No vehicle assigned to this rental." };

  // Both the first rent period and the refundable deposit must be paid
  // before the car is handed over. Rentals scheduled before this mechanism
  // existed (no deposit recorded on them) keep the old rule: any payment.
  const { data: paidRows } = await supabase
    .from("payment")
    .select("amount, kind")
    .eq("rental_id", rentalId)
    .eq("status", "paid");
  const paidRent = (paidRows ?? []).filter((p) => p.kind !== "deposit").reduce((t, p) => t + Number(p.amount), 0);
  const paidDeposit = (paidRows ?? []).filter((p) => p.kind === "deposit").reduce((t, p) => t + Number(p.amount), 0);

  const { data: rate } = await supabase
    .from("rental")
    .select("agreed_weekly_rate_usd, deposit_required_usd, booking:booking_id(quoted_amount)")
    .eq("id", rentalId)
    .single();

  const depositRequired = rate?.deposit_required_usd != null ? Number(rate.deposit_required_usd) : null;
  if (depositRequired === null) {
    if ((paidRows ?? []).length === 0) return { success: false, error: "Record a payment/deposit before confirming pickup." };
  } else {
    const firstRentDue =
      rate?.agreed_weekly_rate_usd != null
        ? Number(rate.agreed_weekly_rate_usd)
        : Number((rate?.booking as any)?.quoted_amount ?? 0);
    if (paidDeposit + 0.005 < depositRequired) {
      return { success: false, error: `Collect the refundable deposit ($${depositRequired.toFixed(2)}) before confirming pickup.` };
    }
    if (paidRent + 0.005 < firstRentDue) {
      return { success: false, error: `Collect the first rent payment ($${firstRentDue.toFixed(2)}) before confirming pickup.` };
    }
  }

  // A runner must finish the guided handover (ID check, photos, walkthrough video, rules explained) first.
  // The agreement and the payment were checked above, so they count as done here.
  if ((await currentRoleName(supabase)) === "field_staff") {
    if (validMileage(startMileage) === null) return { success: false, error: "Enter the starting mileage as a whole number." };
    const loaded = await loadHandoverState(supabase, rentalId);
    const ruleIds = briefingRules(await loadRuleValues(supabase)).map((r) => r.id);
    const missing = handoverMissing(toHandoverState(loaded, { agreementSigned: true, cardCharged: true }), ruleIds);
    if (missing.length > 0) return { success: false, error: `Not ready yet. ${missing[0]}.` };
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
      ? "You don’t have permission to confirm pickup."
      : rentalUpdateError.message?.toLowerCase().includes("renter insurance is not verified")
        ? "This customer’s insurance isn’t verified as active yet."
        : "Couldn’t confirm pickup. Please try again.";
    return { success: false, error: msg };
  }

  const { error: mileageError } = await supabase.from("rental_segment").update({ start_mileage: startMileage }).eq("id", segment.id);
  if (mileageError) console.error("[confirmPickup] start mileage not saved:", mileageError.message);

  if (rental.booking_id) {
    const { error: bookingError } = await supabase.from("booking").update({ return_at: expectedReturnAt }).eq("id", rental.booking_id);
    if (bookingError) console.error("[confirmPickup] booking return date not saved:", bookingError.message);
  }

  const { error: vehicleError } = await supabase
    .from("vehicle")
    .update({ status: "rented" })
    .eq("id", segment.vehicle_id);
  if (vehicleError) {
    const msg = vehicleError.message?.toLowerCase().includes("permission")
      ? "You don’t have permission to mark the vehicle rented."
      : "Couldn’t update the vehicle.";
    // The rental is already active. Tapping confirm again finishes the remaining steps.
    return { success: false, error: `${msg} The rental is started, so tap confirm again to finish.` };
  }

  await supabase.from("customer").update({ status: "active" }).eq("id", rental.customer_id);

  revalidatePath("/staff/fleet");

  // The renter gets their house rules (text + email) with the review link. Never blocks or fails the pickup.
  const sent = await sendPostPickupMessage(rental.id);
  const rulesSent = sent.sms === "sent" || sent.email === "sent";

  void logAuditEvent({
    tenantId: rental.tenant_id,
    action: "rental_pickup_confirmed",
    entityType: "rental",
    entityId: rentalId,
    afterData: { startMileage, vehicleId: segment.vehicle_id, rulesSent },
    source: "staff_portal",
  });

  return {
    success: true,
    rulesSent,
    rulesNote: rulesSent ? undefined : "We couldn’t text or email the rules (outside texting hours, no contact on file, or sending is off). The renter can read them in their portal under Rules.",
  };
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
    .select("id, tenant_id, status, assigned_runner_id, rental_segment(id, vehicle_id, start_mileage)")
    .eq("id", rentalId)
    .single();

  if (!rental) return { success: false, error: "Rental not found." };
  const meDrop = await currentUser(supabase);
  if (meDrop?.role === "field_staff" && rental.assigned_runner_id !== meDrop.id) {
    return { success: false, error: "This drop-off isn’t assigned to you." };
  }
  if (rental.status !== "active") return { success: false, error: "This rental isn’t currently active." };
  if (!Number.isInteger(endMileage) || endMileage < 0 || endMileage > 2_000_000) {
    return { success: false, error: "Enter the ending mileage as a whole number." };
  }

  const segment = (rental.rental_segment as any)?.[0];
  if (!segment) return { success: false, error: "No vehicle assigned to this rental." };
  if (segment.start_mileage != null && endMileage < Number(segment.start_mileage)) {
    return { success: false, error: `Ending mileage can’t be lower than the starting mileage (${segment.start_mileage}).` };
  }

  const now = new Date().toISOString();

  for (const status of ["return_pending", "returned", "closed"] as const) {
    const { error } = await supabase.from("rental").update({ status }).eq("id", rentalId);
    if (error) {
      const msg = error.message?.toLowerCase().includes("permission")
        ? "You don’t have permission to confirm dropoff."
        : `Couldn’t move the rental to "${status}".`;
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
      ? "You don’t have permission to free up the vehicle."
      : "Couldn’t update the vehicle.";
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
  methodType: string,
  kind: "rent" | "deposit" = "rent"
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  if ((await currentRoleName(supabase)) === "field_staff") return { success: false, error: OFFICE_ONLY } as any;

  if (!(ACCEPTED_PAYMENT_METHODS as readonly string[]).includes(methodType)) {
    return { success: false, error: "Only card payments are accepted (in the renter’s own name). Cash isn’t accepted." };
  }
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: "Enter a valid amount." };
  if (kind !== "rent" && kind !== "deposit") return { success: false, error: "Choose rent or deposit." };

  const { data: rental } = await supabase
    .from("rental")
    .select("id, tenant_id, customer_id, deposit_required_usd")
    .eq("id", rentalId)
    .single();
  if (!rental) return { success: false, error: "Rental not found." };

  if (kind === "deposit") {
    const { data: held } = await supabase.from("deposit").select("amount_collected").eq("rental_id", rentalId);
    const alreadyHeld = (held ?? []).reduce((sum, d) => sum + Number(d.amount_collected ?? 0), 0);
    const required = rental.deposit_required_usd !== null ? Number(rental.deposit_required_usd) : null;
    if (required !== null && alreadyHeld + amount > required + 0.005) {
      return { success: false, error: `That would put the deposit above the required $${required.toFixed(2)} ($${alreadyHeld.toFixed(2)} already collected).` };
    }
  }

  const { data: payment, error } = await supabase
    .from("payment")
    .insert({
      tenant_id: rental.tenant_id,
      rental_id: rental.id,
      customer_id: rental.customer_id,
      method_type: methodType,
      amount,
      kind,
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    const msg = error.message?.toLowerCase().includes("permission")
      ? "You don’t have permission to record a payment."
      : "Couldn’t record that payment. Please try again.";
    return { success: false, error: msg };
  }

  // A deposit is also held in the deposit table, which is what deductions
  // and refunds work from (separate from rent).
  if (kind === "deposit") {
    const { data: existing } = await supabase
      .from("deposit")
      .select("id, amount_collected, refundable_amount")
      .eq("rental_id", rentalId)
      .eq("status", "held")
      .maybeSingle();
    if (existing) {
      await supabase
        .from("deposit")
        .update({
          amount_collected: Number(existing.amount_collected) + amount,
          refundable_amount: Number(existing.refundable_amount ?? existing.amount_collected) + amount,
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("deposit").insert({
        tenant_id: rental.tenant_id,
        rental_id: rentalId,
        amount_collected: amount,
        refundable_amount: amount,
        status: "held",
      });
    }
  }

  revalidatePath("/staff/fleet");

  if (payment) {
    void logAuditEvent({
      tenantId: rental.tenant_id,
      action: "payment_recorded",
      entityType: "payment",
      entityId: payment.id,
      afterData: { amount, methodType, rentalId, kind },
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
      lineLabel: kind === "deposit" ? "Security deposit received (card)" : `Rent payment received (${methodType})`,
      relatedPaymentId: payment.id,
    });
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// ADMIN: change a rental’s insurance arrangement after scheduling (e.g. the
// renter’s own policy lapses, or they buy cover through a provider). The
// rate is recomputed from the CURRENT pricing rules. Weekly plan: the
// payment schedule amount changes from the next payment on (rent already
// paid is untouched). Daily plan: only while still scheduled. Requires the
// manage_pricing permission (same gate as editing the pricing itself).
// Audited with before/after.
// ---------------------------------------------------------------------------
export async function changeRentalInsurance(
  rentalId: string,
  arrangement: InsuranceArrangement
): Promise<{ success: boolean; error?: string; newWeeklyRate?: number }> {
  if (arrangement !== "own" && arrangement !== "via_provider") return { success: false, error: "Choose an insurance arrangement." };
  const supabase = await createClient();
  if ((await currentRoleName(supabase)) === "field_staff") return { success: false, error: OFFICE_ONLY } as any;

  const { data: allowed } = await supabase.rpc("can_manage_pricing");
  if (allowed !== true) return { success: false, error: "You don’t have permission to change a renter’s rate." };

  const { data: rental } = await supabase
    .from("rental")
    .select("id, tenant_id, status, insurance_arrangement, agreed_weekly_rate_usd, booking_id, actual_return_at")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) return { success: false, error: "Rental not found." };
  if (rental.actual_return_at || !["scheduled", "active", "extended"].includes(rental.status)) {
    return { success: false, error: "This rental is closed, so its rate can’t be changed." };
  }
  if (rental.insurance_arrangement === arrangement) return { success: false, error: "That’s already this rental’s arrangement." };

  const { data: policy } = await supabase
    .from("policy_version")
    .select("rules")
    .eq("tenant_id", rental.tenant_id)
    .eq("policy_type", "pricing_and_mileage")
    .maybeSingle();
  const rules = (policy?.rules as any) ?? {};

  if (rental.agreed_weekly_rate_usd !== null) {
    const weekly = computeWeeklyRate(rules.weekly_rate_usd, arrangement, rules.insurance);
    if (!weekly.ok) return { success: false, error: weekly.error };

    // Guarded table (manage_pricing) first, then the rental record.
    const { error: schedError } = await supabase
      .from("payment_schedule")
      .update({ amount: weekly.amount })
      .eq("rental_id", rentalId)
      .eq("status", "active")
      .eq("cadence", "weekly");
    if (schedError) return { success: false, error: "Couldn’t update the payment schedule. Nothing was changed." };

    const { error: rentalError } = await supabase
      .from("rental")
      .update({ insurance_arrangement: arrangement, agreed_weekly_rate_usd: weekly.amount })
      .eq("id", rentalId);
    if (rentalError) return { success: false, error: "The schedule was updated but the rental record wasn’t. Please contact support." };

    void logAuditEvent({
      tenantId: rental.tenant_id,
      action: "rental.insurance_arrangement_changed",
      entityType: "rental",
      entityId: rentalId,
      beforeData: { insurance_arrangement: rental.insurance_arrangement, agreed_weekly_rate_usd: rental.agreed_weekly_rate_usd },
      afterData: { insurance_arrangement: arrangement, agreed_weekly_rate_usd: weekly.amount },
      source: "staff",
    });
    revalidatePath("/staff/pickups");
    return { success: true, newWeeklyRate: weekly.amount };
  }

  // Daily plan: the whole term was priced up front, so only a rental that
  // hasn’t started can be re-priced.
  if (rental.status !== "scheduled") {
    return { success: false, error: "A daily rental that has already started can’t be re-priced here." };
  }
  if (!rental.booking_id) return { success: false, error: "No booking found for this rental." };
  const { data: booking } = await supabase
    .from("booking")
    .select("id, pickup_at, return_at")
    .eq("id", rental.booking_id)
    .maybeSingle();
  if (!booking) return { success: false, error: "Booking not found." };
  const window = validateRentalWindow(new Date(booking.pickup_at), new Date(booking.return_at));
  if (!window.ok) return { success: false, error: window.error };

  const requoted = await requoteDaily(supabase, rental.tenant_id, window.days, arrangement);
  if (requoted === null) return { success: false, error: "Couldn’t compute the daily price. Check the Pricing page." };

  const { error: bookingError } = await supabase.from("booking").update({ quoted_amount: requoted }).eq("id", booking.id);
  if (bookingError) return { success: false, error: "Couldn’t update the quote. Nothing was changed." };
  const { error: rentalError } = await supabase.from("rental").update({ insurance_arrangement: arrangement }).eq("id", rentalId);
  if (rentalError) return { success: false, error: "The quote was updated but the rental record wasn’t. Please contact support." };

  void logAuditEvent({
    tenantId: rental.tenant_id,
    action: "rental.insurance_arrangement_changed",
    entityType: "rental",
    entityId: rentalId,
    beforeData: { insurance_arrangement: rental.insurance_arrangement },
    afterData: { insurance_arrangement: arrangement, quoted_amount: requoted },
    source: "staff",
  });
  revalidatePath("/staff/pickups");
  return { success: true };
}

// ---------------------------------------------------------------------------
// STAFF: mark a pickup-call follow-up as handled. The reminder assistant
// raises needs_human_followup when a renter needs to reschedule, can’t make
// it, or needs help; this clears it once a person has dealt with it. Does
// not touch the rental’s status, appointment or payments.
// ---------------------------------------------------------------------------
export async function resolvePickupFollowup(rentalId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: rental } = await supabase
    .from("rental")
    .select("id, tenant_id, needs_human_followup, last_call_outcome")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) return { success: false, error: "Rental not found." };
  if (!rental.needs_human_followup) return { success: true };

  const { error } = await supabase.from("rental").update({ needs_human_followup: false }).eq("id", rentalId);
  if (error) return { success: false, error: "Couldn’t mark that as handled. Please try again." };

  void logAuditEvent({
    tenantId: rental.tenant_id,
    action: "rental.pickup_followup_resolved",
    entityType: "rental",
    entityId: rentalId,
    beforeData: { needs_human_followup: true, last_call_outcome: rental.last_call_outcome },
    afterData: { needs_human_followup: false },
    source: "staff",
  });

  revalidatePath("/staff/pickups");
  return { success: true };
}
