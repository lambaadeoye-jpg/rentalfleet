"use server";

import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/staff-role";
import type { InsuranceArrangement } from "@/lib/rental-rate";

// Staff-only money summary for a rental (renters never see this).
export type RentalMoney = {
  arrangement: InsuranceArrangement | null;
  plan: "weekly" | "daily" | null;
  weeklyRateUsd: number | null;
  quotedAmountUsd: number | null;
  depositRequiredUsd: number | null;
  rentPaidUsd: number;
  depositPaidUsd: number;
  nextDueAt: string | null;
};

export type PickupItem = {
  rentalId: string;
  vehicleId: string;
  customerFirstName: string;
  customerLastName: string;
  customerPhone: string | null;
  assignedRunnerId: string | null;
  agreementSigned: boolean;
  vehicleLabel: string;
  hasLicenseDocument: boolean;
  insuranceVerified: boolean;
  pickupAt: string | null;
  pickupLocationId: string | null;
  pickupConfirmedAt: string | null;
  expectedReturnAt: string | null;
  dropOffManuallySet: boolean;
  money: RentalMoney;
  followup: {
    needed: boolean;
    outcome: string | null;
    summary: string | null;
    at: string | null;
    committedTime: string | null;
  };
};

export type DropoffItem = {
  rentalId: string;
  vehicleId: string;
  customerFirstName: string;
  customerLastName: string;
  customerPhone: string | null;
  assignedRunnerId: string | null;
  vehicleLabel: string;
  startMileage: number | null;
  expectedReturnAt: string | null;
  dropOffManuallySet: boolean;
  money: RentalMoney;
};

async function loadMoney(supabase: Awaited<ReturnType<typeof createClient>>, r: any): Promise<RentalMoney> {
  const [{ data: pays }, { data: sched }] = await Promise.all([
    supabase.from("payment").select("amount, kind").eq("rental_id", r.id).eq("status", "paid"),
    supabase.from("payment_schedule").select("next_due_at").eq("rental_id", r.id).eq("status", "active").eq("cadence", "weekly").maybeSingle(),
  ]);
  const rows = pays ?? [];
  return {
    arrangement: (r.insurance_arrangement as InsuranceArrangement | null) ?? null,
    plan: r.agreed_weekly_rate_usd != null ? "weekly" : r.insurance_arrangement ? "daily" : null,
    weeklyRateUsd: r.agreed_weekly_rate_usd != null ? Number(r.agreed_weekly_rate_usd) : null,
    quotedAmountUsd: (r.booking as any)?.quoted_amount != null ? Number((r.booking as any).quoted_amount) : null,
    depositRequiredUsd: r.deposit_required_usd != null ? Number(r.deposit_required_usd) : null,
    rentPaidUsd: rows.filter((p) => p.kind !== "deposit").reduce((t, p) => t + Number(p.amount), 0),
    depositPaidUsd: rows.filter((p) => p.kind === "deposit").reduce((t, p) => t + Number(p.amount), 0),
    nextDueAt: sched?.next_due_at ?? null,
  };
}

export type RunnerOption = { id: string; name: string };

export async function getPickupsAndDropoffs(): Promise<{ pickups: PickupItem[]; dropoffs: DropoffItem[]; isRunner: boolean; runners: RunnerOption[] }> {
  const supabase = await createClient();
  const me = await currentUser(supabase);
  const isRunner = me?.role === "field_staff";
  // A runner sees only the rentals assigned to them. Fail closed if we can't tell who is asking.
  if (!me) return { pickups: [], dropoffs: [], isRunner: true, runners: [] };

  const scope = (q: any) => (isRunner ? q.eq("assigned_runner_id", me.id) : q);

  const [{ data: scheduled }, { data: active }] = await Promise.all([
    scope(supabase
      .from("rental")
      .select("id, assigned_runner_id, pickup_confirmed_at, expected_return_at, drop_off_manually_set, needs_human_followup, missed_pickup_at, last_call_outcome, last_call_summary, last_call_at, last_call_committed_time, insurance_arrangement, agreed_weekly_rate_usd, deposit_required_usd, booking:booking_id(pickup_at, pickup_location_id, quoted_amount), customer:customer_id(id, first_name, last_name, phone), rental_segment(vehicle_id, vehicle:vehicle_id(make, model, year))")
      .eq("status", "scheduled")),
    scope(supabase
      .from("rental")
      .select("id, assigned_runner_id, expected_return_at, drop_off_manually_set, insurance_arrangement, agreed_weekly_rate_usd, deposit_required_usd, booking:booking_id(quoted_amount), customer:customer_id(first_name, last_name, phone), rental_segment(vehicle_id, vehicle:vehicle_id(make, model, year), start_mileage)")
      .eq("status", "active")),
  ]);

  const scheduledIds = (scheduled ?? []).map((r: any) => r.id);
  const { data: signedRows } = scheduledIds.length
    ? await supabase.from("signed_document").select("rental_id").in("rental_id", scheduledIds).not("sign_request_id", "is", null)
    : { data: [] as { rental_id: string }[] };
  const signedSet = new Set((signedRows ?? []).map((r) => r.rental_id));

  const pickups: PickupItem[] = await Promise.all(
    (scheduled ?? []).map(async (r: any) => {
      const customer = r.customer as any;
      const segment = (r.rental_segment as any)?.[0];
      const vehicle = segment?.vehicle;

      const [{ count: docCount }, { data: insurance }] = await Promise.all([
        supabase
          .from("customer_document")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customer?.id)
          .eq("document_type", "drivers_license"),
        supabase
          .from("insurance_policy")
          .select("verification_status")
          .eq("customer_id", customer?.id)
          .eq("policy_type", "renter")
          .maybeSingle(),
      ]);

      return {
        rentalId: r.id,
        vehicleId: segment?.vehicle_id ?? "",
        customerFirstName: customer?.first_name ?? "",
        customerLastName: customer?.last_name ?? "",
        customerPhone: customer?.phone ?? null,
        assignedRunnerId: (r as any).assigned_runner_id ?? null,
        agreementSigned: signedSet.has(r.id),
        vehicleLabel: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "No vehicle assigned",
        hasLicenseDocument: (docCount ?? 0) > 0,
        insuranceVerified:
          insurance?.verification_status === "verified_active" || insurance?.verification_status === "expiring_soon",
        // pickup_at is only a real appointment when a location was also
        // set; scheduleRental’s placeholder "now" never has one.
        pickupAt: (r.booking as any)?.pickup_location_id ? ((r.booking as any)?.pickup_at ?? null) : null,
        pickupLocationId: (r.booking as any)?.pickup_location_id ?? null,
        pickupConfirmedAt: (r as any).pickup_confirmed_at ?? null,
        // Only meaningful once an appointment is set; before that it is
        // scheduleRental’s placeholder, so don’t present it as staff’s choice.
        expectedReturnAt: (r.booking as any)?.pickup_location_id ? ((r as any).expected_return_at ?? null) : null,
        dropOffManuallySet: Boolean((r as any).drop_off_manually_set),
        money: await loadMoney(supabase, r),
        followup: {
          needed: Boolean((r as any).needs_human_followup),
          outcome: (r as any).last_call_outcome ?? null,
          summary: (r as any).last_call_summary ?? ((r as any).missed_pickup_at ? "Missed pickup: the renter didn’t arrive. They were texted a link to choose a new time, or reply CHANGE. Resolve this once handled." : null),
          at: (r as any).last_call_at ?? null,
          committedTime: (r as any).last_call_committed_time ?? null,
        },
      };
    })
  );

  // Rentals that need a person come first.
  pickups.sort((a, b) => Number(b.followup.needed) - Number(a.followup.needed));

  const dropoffs: DropoffItem[] = await Promise.all((active ?? []).map(async (r: any) => {
    const customer = r.customer as any;
    const segment = (r.rental_segment as any)?.[0];
    const vehicle = segment?.vehicle;
    return {
      rentalId: r.id,
      vehicleId: segment?.vehicle_id ?? "",
      customerFirstName: customer?.first_name ?? "",
      customerLastName: customer?.last_name ?? "",
      customerPhone: customer?.phone ?? null,
      assignedRunnerId: (r as any).assigned_runner_id ?? null,
      vehicleLabel: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "No vehicle assigned",
      startMileage: segment?.start_mileage ?? null,
      expectedReturnAt: (r as any).expected_return_at ?? null,
      dropOffManuallySet: Boolean((r as any).drop_off_manually_set),
      money: await loadMoney(supabase, r),
    };
  }));

  // The office picks who does each job; runners don't need the list.
  let runners: RunnerOption[] = [];
  if (!isRunner) {
    const { data: members } = await supabase
      .from("membership")
      .select("user_id, role:role_id(name), user_profile:user_id(full_name, email)");
    runners = (members ?? [])
      .filter((m: any) => m.role?.name === "field_staff")
      .map((m: any) => ({ id: m.user_id as string, name: (m.user_profile?.full_name || m.user_profile?.email || "Runner") as string }));
  }

  return { pickups, dropoffs, isRunner, runners };
}
