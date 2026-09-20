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

// Converts an approved application into a real rental: booking -> rental
// (walked through its locked state machine to active) -> vehicle
// assignment -> vehicle walked to rented -> customer promoted from
// 'applicant' to 'active'. This is the connective tissue that was
// completely missing -- without it, an approved applicant had no path to
// ever becoming a real, active renter.
//
// Deliberately collapses "reserve" and "hand over the keys" into one staff
// action, since no separate pickup/inspection UI exists yet -- a more
// complete system would split these. Flagged here, not silently assumed.
//
// Every write below is independently enforced at the database level
// (assign_vehicle, manage_fleet, and the new start_rental permission from
// migration 0028, plus state-machine validity from 0018/0029) -- this
// function doesn't duplicate those checks, it just does the writes and
// surfaces whatever the database actually decides.
export async function startRental(
  applicationId: string,
  vehicleId: string,
  rentalOption: "daily" | "weekly"
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: application } = await supabase
    .from("application")
    .select("id, tenant_id, customer_id, status")
    .eq("id", applicationId)
    .single();

  if (!application) return { success: false, error: "Application not found." };
  if (application.status !== "approved" && application.status !== "conditionally_approved") {
    return { success: false, error: "Only approved applications can start a rental." };
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

  // Daily pricing is a locked, calculable formula (V2.1 §10): $220 for the
  // first 3 days, $74/day after, 7-day minimum. Weekly pricing is
  // deliberately NOT invented here -- same "don't guess the number" rule
  // applied to a backend calculation, not just marketing copy.
  const days = 7;
  const quotedAmount = rentalOption === "daily" ? 220 + 4 * 74 : null;

  const pickupAt = new Date();
  const returnAt = new Date(pickupAt.getTime() + days * 24 * 60 * 60 * 1000);

  const { data: booking, error: bookingError } = await supabase
    .from("booking")
    .insert({
      tenant_id: application.tenant_id,
      customer_id: application.customer_id,
      category_id: vehicle.category_id,
      channel_id: channel?.id ?? null,
      pickup_at: pickupAt.toISOString(),
      return_at: returnAt.toISOString(),
      status: "confirmed",
      quoted_amount: quotedAmount,
    })
    .select("id")
    .single();

  if (bookingError || !booking) return { success: false, error: "Couldn't create the booking. Please try again." };

  const { data: policy } = await supabase
    .from("policy_version")
    .select("rules")
    .eq("tenant_id", application.tenant_id)
    .eq("policy_type", "pricing_and_mileage")
    .maybeSingle();

  const { data: rental, error: rentalError } = await supabase
    .from("rental")
    .insert({
      tenant_id: application.tenant_id,
      customer_id: application.customer_id,
      booking_id: booking.id,
      status: "pending",
      start_at: pickupAt.toISOString(),
      expected_return_at: returnAt.toISOString(),
      governing_policy_snapshot: policy?.rules ?? {},
    })
    .select("id")
    .single();

  if (rentalError || !rental) return { success: false, error: "Couldn't create the rental. Please try again." };

  // Walk the locked rental state machine one hop at a time -- each is
  // independently validated by the database (migration 0018/0029), and the
  // final hop to 'active' also requires verified renter insurance on file
  // (migration 0030).
  for (const status of ["approved", "scheduled", "active"] as const) {
    const { error } = await supabase.from("rental").update({ status }).eq("id", rental.id);
    if (error) {
      let msg = `Couldn't move the rental to "${status}". ${error.message}`;
      if (error.message?.toLowerCase().includes("permission")) {
        msg = "You don't have permission to activate a rental.";
      } else if (error.message?.toLowerCase().includes("renter insurance is not verified")) {
        msg = "This customer's insurance isn't verified as active yet. Check Insurance before starting the rental.";
      }
      return { success: false, error: msg };
    }
  }

  const { error: segmentError } = await supabase.from("rental_segment").insert({
    tenant_id: application.tenant_id,
    rental_id: rental.id,
    vehicle_id: vehicleId,
    starts_at: pickupAt.toISOString(),
  });
  if (segmentError) {
    const msg = segmentError.message?.toLowerCase().includes("permission")
      ? "You don't have permission to assign a vehicle."
      : "Couldn't assign the vehicle. Please try again.";
    return { success: false, error: msg };
  }

  for (const status of ["reserved", "rented"] as const) {
    const { error } = await supabase.from("vehicle").update({ status }).eq("id", vehicleId);
    if (error) {
      const msg = error.message?.toLowerCase().includes("permission")
        ? "You don't have permission to update vehicle status."
        : `Couldn't move the vehicle to "${status}".`;
      return { success: false, error: msg };
    }
  }

  await supabase.from("customer").update({ status: "active" }).eq("id", application.customer_id);

  // Creates the recurring payment schedule the Upcoming Payment Reminder
  // workflow reads from -- but only if a real weekly rate actually exists.
  // policy_version.rules.weekly_rate_usd is deliberately left unset until
  // the business decides the real number (same "don't invent it" rule
  // applied to quotedAmount above); payment_schedule.amount is NOT NULL,
  // so writing a fabricated number into a real financial record would be
  // worse than just not creating the schedule yet. "Anchored to the
  // rental start date" per the locked recurring-billing rule -- first
  // payment due exactly 7 days after pickup, not the calendar week.
  const weeklyRate = (policy?.rules as any)?.weekly_rate_usd;
  if (weeklyRate) {
    await supabase.from("payment_schedule").insert({
      tenant_id: application.tenant_id,
      rental_id: rental.id,
      cadence: "weekly",
      next_due_at: returnAt.toISOString(),
      amount: weeklyRate,
      status: "active",
    });
  }

  revalidatePath(`/staff/applications/${applicationId}`);
  revalidatePath("/staff/fleet");

  // Fire-and-forget, same pattern as submitLead()/decideApplication() --
  // never blocks or fails the rental start itself if n8n is down/slow.
  // Fetched separately from the writes above so a failure here can't
  // affect anything already committed.
  const { data: customer } = await supabase
    .from("customer")
    .select("first_name, phone, email")
    .eq("id", application.customer_id)
    .maybeSingle();

  void fireN8nWebhook(N8N_WEBHOOK_PATHS.pickupReviewRequest, {
    rentalId: rental.id,
    customerFirstName: customer?.first_name ?? null,
    customerPhone: customer?.phone ?? null,
    customerEmail: customer?.email ?? null,
  });

  return { success: true };
}
