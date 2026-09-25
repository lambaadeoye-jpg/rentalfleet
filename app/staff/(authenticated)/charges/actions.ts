"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit-log";
import { generateAndStoreFinancialDocument } from "@/lib/generate-financial-document";

export type ChargeRecord = {
  id: string;
  customerName: string;
  chargeType: string;
  amount: number;
  responsibility: string;
  approvalStatus: string;
  isDeductible: boolean;
  createdAt: string;
};

export type RentalOption = { id: string; customerId: string; label: string; hasOpenDeposit: boolean };

const CHARGE_TYPES = ["toll", "ticket", "cleaning", "damage", "other"] as const;

export async function getCharges(): Promise<ChargeRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("charge")
    .select("id, charge_type, amount, responsibility, approval_status, deposit_id, created_at, customer:customer_id(first_name, last_name)")
    .order("created_at", { ascending: false })
    .limit(100);

  return (data ?? []).map((c) => {
    const customer = c.customer as any;
    return {
      id: c.id,
      customerName: customer ? `${customer.first_name} ${customer.last_name}` : "Unknown",
      chargeType: c.charge_type,
      amount: Number(c.amount),
      responsibility: c.responsibility,
      approvalStatus: c.approval_status,
      isDeductible: c.deposit_id != null,
      createdAt: c.created_at,
    };
  });
}

export async function getActiveRentalsForCharging(): Promise<RentalOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rental")
    .select("id, customer_id, customer:customer_id(first_name, last_name), deposit(id, status)")
    .in("status", ["active", "returned", "closed"])
    .order("created_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((r) => {
    const customer = r.customer as any;
    const deposits = (r.deposit as any[]) ?? [];
    return {
      id: r.id,
      customerId: r.customer_id,
      label: customer ? `${customer.first_name} ${customer.last_name}` : "Unknown",
      hasOpenDeposit: deposits.some((d) => d.status === "held"),
    };
  });
}

// Permission-gated at the database level (charge_insert_guard, requiring
// approve_charge -- migration 0050).
export async function logCharge(
  rentalId: string,
  customerId: string,
  chargeType: (typeof CHARGE_TYPES)[number],
  amount: number,
  deductFromDeposit: boolean
): Promise<{ success: boolean; error?: string }> {
  if (amount <= 0) return { success: false, error: "Enter a positive amount." };

  const supabase = await createClient();
  const { data: rental } = await supabase.from("rental").select("id, tenant_id").eq("id", rentalId).single();
  if (!rental) return { success: false, error: "Rental not found." };

  let depositId: string | null = null;
  if (deductFromDeposit) {
    const { data: deposit } = await supabase
      .from("deposit")
      .select("id, refundable_amount")
      .eq("rental_id", rentalId)
      .eq("status", "held")
      .maybeSingle();

    if (!deposit) {
      return { success: false, error: "No held deposit found for this rental to deduct from." };
    }
    if ((deposit.refundable_amount ?? 0) < amount) {
      return { success: false, error: `Only $${(deposit.refundable_amount ?? 0).toFixed(2)} remains refundable on this deposit.` };
    }
    depositId = deposit.id;
  }

  const { error } = await supabase.from("charge").insert({
    tenant_id: rental.tenant_id,
    rental_id: rentalId,
    customer_id: customerId,
    charge_type: chargeType,
    amount,
    responsibility: "renter",
    deposit_id: depositId,
  });

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to log a charge." };
    }
    return { success: false, error: "Couldn't log that charge. Please try again." };
  }

  void logAuditEvent({
    tenantId: rental.tenant_id,
    action: "charge_logged",
    entityType: "charge",
    entityId: rentalId,
    afterData: { chargeType, amount, deductFromDeposit },
    source: "staff_portal",
  });

  revalidatePath("/staff/charges");
  return { success: true };
}

// Approving a charge: if it's deposit-linked, reduces that deposit's
// refundable_amount explicitly in application code (not a DB trigger) --
// same visible, auditable pattern as every other financial side effect
// in this build.
export async function approveCharge(chargeId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: charge } = await supabase.from("charge").select("id, tenant_id, amount, deposit_id").eq("id", chargeId).single();
  if (!charge) return { success: false, error: "Charge not found." };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("charge")
    .update({ approval_status: "approved", approved_at: new Date().toISOString(), approved_by: user?.id ?? null })
    .eq("id", chargeId);

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to approve charges." };
    }
    return { success: false, error: "Couldn't approve that charge." };
  }

  if (charge.deposit_id) {
    const { data: deposit } = await supabase.from("deposit").select("refundable_amount").eq("id", charge.deposit_id).single();
    if (deposit) {
      const newRefundable = Math.max(0, (deposit.refundable_amount ?? 0) - Number(charge.amount));
      await supabase.from("deposit").update({ refundable_amount: newRefundable }).eq("id", charge.deposit_id);
    }
  }

  void logAuditEvent({
    tenantId: charge.tenant_id,
    action: "charge_approved",
    entityType: "charge",
    entityId: chargeId,
    afterData: { amount: charge.amount, depositDeducted: !!charge.deposit_id },
    source: "staff_portal",
  });

  // Deposit-deducted charges don't need an invoice -- there's nothing
  // separately owed, the deposit already covered it. Only bill-
  // separately charges get one.
  if (!charge.deposit_id) {
    const { data: chargeDetails } = await supabase
      .from("charge")
      .select("rental_id, customer_id, charge_type")
      .eq("id", chargeId)
      .single();

    if (chargeDetails?.rental_id && chargeDetails?.customer_id) {
      void generateAndStoreFinancialDocument({
        documentType: "invoice",
        rentalId: chargeDetails.rental_id,
        customerId: chargeDetails.customer_id,
        amount: Number(charge.amount),
        lineLabel: chargeDetails.charge_type,
        relatedChargeId: chargeId,
      });
    }
  }

  revalidatePath("/staff/charges");
  return { success: true };
}
