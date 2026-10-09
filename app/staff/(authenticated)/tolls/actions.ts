"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit-log";
import { CHARGE_TYPE, DEFAULT_FEES, TOLL_KINDS, chargeTotal, isFlagged, isPastDeadline, localToIso, matchRental, parseMoney, payByFrom, ticketCounts, type RentalWindow, type TollKind } from "@/lib/tolls";
import { loadRuleValues } from "@/lib/handover-server";

type Result = { success: boolean; error?: string; note?: string };

export type TollRow = {
  id: string;
  kind: TollKind;
  vehicle: string;
  plate: string | null;
  renter: string | null;
  rentalId: string | null;
  amount: number;
  occurredAt: string | null;
  reference: string | null;
  description: string | null;
  status: "open" | "charged" | "waived" | "paid";
  chargeStatus: string | null;
  defaultFee: number;
  payBy: string | null;
  pastDeadline: boolean;
  /** Tickets this renter has on this rental (waived ones don't count). */
  renterTickets: number;
  flagged: boolean;
};

export type TicketWatch = { rentalId: string; renter: string; count: number };

export async function getTolls(): Promise<{ rows: TollRow[]; vehicles: { id: string; label: string }[]; needsMigration: boolean; watch: TicketWatch[]; threshold: number; payHours: number }> {
  const supabase = await createClient();
  const rules = await loadRuleValues(supabase);
  const [{ data, error }, { data: vehicleRows }] = await Promise.all([
    supabase
      .from("toll_transaction")
      .select(
        "id, kind, amount, occurred_at, external_reference, description, status, pay_by, rental_id, vehicle:vehicle_id(year, make, model, plate), rental:rental_id(customer:customer_id(first_name, last_name)), charge:charge_id(approval_status)"
      )
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(200),
    supabase.from("vehicle").select("id, year, make, model, plate").not("status", "in", "(sold)").order("created_at", { ascending: true }),
  ]);

  const vehicles = (vehicleRows ?? []).map((v: any) => ({
    id: v.id,
    label: `${[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}${v.plate ? ` · ${v.plate}` : ""}`,
  }));
  if (error) return { rows: [], vehicles, needsMigration: true, watch: [], threshold: rules.ticketReviewThreshold, payHours: rules.ticketPayHours };

  const counts = ticketCounts((data ?? []).map((t: any) => ({ rentalId: t.rental_id, kind: t.kind, status: t.status })));
  const now = new Date();
  const names = new Map<string, string>();
  const rows: TollRow[] = (data ?? []).map((t: any) => {
    const c = t.rental?.customer;
    if (t.rental_id && c) names.set(t.rental_id, `${c.first_name} ${c.last_name}`.trim());
    const v = t.vehicle;
    return {
      id: t.id,
      kind: t.kind,
      vehicle: v ? [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle" : "Unknown car",
      plate: v?.plate ?? null,
      renter: c ? `${c.first_name} ${c.last_name}`.trim() : null,
      rentalId: t.rental_id,
      amount: Number(t.amount),
      occurredAt: t.occurred_at,
      reference: t.external_reference,
      description: t.description,
      status: t.status,
      chargeStatus: t.charge?.approval_status ?? null,
      defaultFee: DEFAULT_FEES[t.kind as TollKind] ?? 0,
      payBy: t.pay_by ?? null,
      pastDeadline: isPastDeadline(t.status, t.pay_by ?? null, now),
      renterTickets: t.rental_id ? counts.get(t.rental_id) ?? 0 : 0,
      flagged: t.rental_id ? isFlagged(counts.get(t.rental_id) ?? 0, rules.ticketReviewThreshold) : false,
    };
  });
  const watch: TicketWatch[] = [...counts.entries()]
    .filter(([, n]) => isFlagged(n, rules.ticketReviewThreshold))
    .map(([rentalId, count]) => ({ rentalId, renter: names.get(rentalId) ?? "Renter", count }))
    .sort((a, b) => b.count - a.count);
  return { rows, vehicles, needsMigration: false, watch, threshold: rules.ticketReviewThreshold, payHours: rules.ticketPayHours };
}

export async function addToll(input: {
  vehicleId: string;
  kind: string;
  amount: string;
  occurredAt: string;
  reference: string;
  description: string;
}): Promise<Result> {
  const supabase = await createClient();
  const { data: tenant } = await supabase.from("tenant").select("id").limit(1).maybeSingle();
  if (!tenant) return { success: false, error: "Something went wrong. Please try again." };

  if (!input.vehicleId) return { success: false, error: "Pick a vehicle." };
  if (!TOLL_KINDS.includes(input.kind as TollKind)) return { success: false, error: "Pick toll or ticket." };
  const amount = parseMoney(input.amount);
  if (amount === null) return { success: false, error: "Enter the amount as dollars and cents, like 4.50." };
  const occurredAt = localToIso(input.occurredAt);
  if (!occurredAt) return { success: false, error: "Enter when it happened." };
  if (Date.parse(occurredAt) > Date.now() + 24 * 3_600_000) return { success: false, error: "That date is in the future." };
  const reference = input.reference.trim().slice(0, 80) || null;
  const description = input.description.trim().slice(0, 200) || null;

  // Which rental had the car at that moment? Uses the car's own time on each rental
  // (its segment), so a mid-rental swap to another car doesn't charge the wrong renter.
  const { data: rentals } = await supabase
    .from("rental")
    .select("id, customer_id, start_at, actual_return_at, status, rental_segment!inner(vehicle_id, starts_at, ends_at)")
    .eq("rental_segment.vehicle_id", input.vehicleId)
    .in("status", ["active", "returned", "closed"]);
  const windows: RentalWindow[] = (rentals ?? []).flatMap((r: any) =>
    (r.rental_segment ?? []).map((seg: any) => ({
      rentalId: r.id,
      customerId: r.customer_id,
      startAt: seg.starts_at ?? r.start_at,
      endAt: seg.ends_at ?? r.actual_return_at,
    }))
  );
  const match = matchRental(windows, occurredAt);

  const { error } = await supabase.from("toll_transaction").insert({
    tenant_id: tenant.id,
    vehicle_id: input.vehicleId,
    rental_id: match?.rentalId ?? null,
    kind: input.kind,
    amount,
    occurred_at: occurredAt,
    external_reference: reference,
    description,
    responsibility: match ? "renter" : "company",
  });
  if (error) {
    if (error.code === "23505") return { success: false, error: "That reference number is already logged." };
    return { success: false, error: "Couldn’t save that. Please try again." };
  }
  revalidatePath("/staff/tolls");
  return match
    ? { success: true }
    : { success: true, note: "Saved, but no rental had this car at that time, so it can’t be charged to a renter. Check the date and car." };
}

export async function chargeRenter(tollId: string, feeText: string): Promise<Result> {
  const supabase = await createClient();
  const fee = feeText.trim() === "" ? 0 : parseMoney(feeText);
  if (fee === null) return { success: false, error: "Enter the fee as dollars and cents, or leave it blank." };

  const { data: toll } = await supabase
    .from("toll_transaction")
    .select("id, tenant_id, kind, amount, rental_id, status, rental:rental_id(customer_id)")
    .eq("id", tollId)
    .maybeSingle();
  if (!toll) return { success: false, error: "That toll wasn’t found." };
  const customerId = (toll.rental as any)?.customer_id as string | undefined;
  if (!toll.rental_id || !customerId) return { success: false, error: "No renter is linked to this one, so it can’t be charged." };
  if (toll.status !== "open") return { success: false, error: "This one has already been handled." };

  // Claim it first so a double-click can't raise two charges.
  const { data: claimed } = await supabase.from("toll_transaction").update({ status: "charged" }).eq("id", tollId).eq("status", "open").select("id");
  if (!claimed || claimed.length === 0) return { success: false, error: "This one has already been handled." };

  const total = chargeTotal(toll.kind as TollKind, Number(toll.amount), fee);
  const { data: charge, error } = await supabase
    .from("charge")
    .insert({
      tenant_id: toll.tenant_id,
      rental_id: toll.rental_id,
      customer_id: customerId,
      charge_type: CHARGE_TYPE[toll.kind as TollKind],
      amount: total,
      responsibility: "renter",
    })
    .select("id")
    .single();

  if (error || !charge) {
    await supabase.from("toll_transaction").update({ status: "open" }).eq("id", tollId); // undo the claim
    if (error?.message?.toLowerCase().includes("permission")) return { success: false, error: "You don’t have permission to log a charge." };
    return { success: false, error: "Couldn’t raise that charge. Please try again." };
  }

  const rules = await loadRuleValues(supabase);
  await supabase.from("toll_transaction").update({ charge_id: charge.id, pay_by: payByFrom(new Date(), rules.ticketPayHours) }).eq("id", tollId);
  void logAuditEvent({
    tenantId: toll.tenant_id,
    action: "toll_charged",
    entityType: "toll_transaction",
    entityId: tollId,
    afterData: { amount: toll.amount, fee, total, chargeId: charge.id },
    source: "staff_portal",
  });
  revalidatePath("/staff/tolls");
  revalidatePath("/staff/charges");
  return { success: true, note: `Charge of $${total.toFixed(2)} sent to Charges for approval.` };
}

export async function markTollPaid(tollId: string): Promise<Result> {
  const supabase = await createClient();
  const { data: updated, error } = await supabase.from("toll_transaction").update({ status: "paid" }).eq("id", tollId).eq("status", "charged").select("id, tenant_id");
  if (error || !updated || updated.length === 0) return { success: false, error: "Couldn’t update that. It may already be handled." };
  void logAuditEvent({ tenantId: updated[0].tenant_id, action: "toll_marked_paid", entityType: "toll_transaction", entityId: tollId, source: "staff_portal" });
  revalidatePath("/staff/tolls");
  return { success: true };
}

export async function waiveToll(tollId: string): Promise<Result> {
  const supabase = await createClient();
  const { data: updated, error } = await supabase.from("toll_transaction").update({ status: "waived" }).eq("id", tollId).eq("status", "open").select("id");
  if (error || !updated || updated.length === 0) return { success: false, error: "Couldn’t update that. It may already be handled." };
  revalidatePath("/staff/tolls");
  return { success: true };
}

export async function deleteToll(tollId: string): Promise<Result> {
  const supabase = await createClient();
  const { data: removed, error } = await supabase.from("toll_transaction").delete().eq("id", tollId).eq("status", "open").select("id");
  if (error || !removed || removed.length === 0) return { success: false, error: "Only entries that haven’t been charged can be deleted." };
  revalidatePath("/staff/tolls");
  return { success: true };
}
