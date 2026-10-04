"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { approveCharge } from "../charges/actions";
import { logAuditEvent } from "@/lib/audit-log";
import type { ExpenseType } from "./expense-types";

export type DelinquentRentalOption = { id: string; customerId: string; label: string };

export type RecoveryCaseSummary = {
  id: string;
  status: string;
  balanceDue: number;
  authorizedAt: string | null;
  customerName: string;
  createdAt: string;
};

export type RecoveryExpenseRow = {
  id: string;
  expenseType: string;
  amount: number;
  responsibility: string;
  approvalStatus: string;
};

export type RecoveryCaseDetail = RecoveryCaseSummary & {
  rentalId: string;
  customerId: string;
  authorizationReason: string | null;
  expenses: RecoveryExpenseRow[];
};

// Rentals that look genuinely delinquent (active, past expected return
// with no actual return recorded) -- a reasonable starting point for
// "which rental might this recovery case be about", not a precise
// delinquency calculation (none exists elsewhere in this build either).
export async function getDelinquentRentalOptions(): Promise<DelinquentRentalOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rental")
    .select("id, customer_id, expected_return_at, customer:customer_id(first_name, last_name)")
    .eq("status", "active")
    .lt("expected_return_at", new Date().toISOString())
    .is("actual_return_at", null)
    .order("expected_return_at", { ascending: true })
    .limit(50);

  return (data ?? []).map((r) => {
    const customer = r.customer as unknown as { first_name: string; last_name: string } | null;
    return {
      id: r.id,
      customerId: r.customer_id,
      label: `${customer?.first_name ?? "Unknown"} ${customer?.last_name ?? ""} — overdue since ${new Date(r.expected_return_at).toLocaleDateString()}`,
    };
  });
}

export async function getRecoveryCases(): Promise<RecoveryCaseSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("recovery_case")
    .select("id, status, balance_due, authorized_at, created_at, customer:customer_id(first_name, last_name)")
    .order("created_at", { ascending: false });

  return (data ?? []).map((c) => {
    const customer = c.customer as unknown as { first_name: string; last_name: string } | null;
    return {
      id: c.id,
      status: c.status,
      balanceDue: Number(c.balance_due ?? 0),
      authorizedAt: c.authorized_at,
      customerName: `${customer?.first_name ?? "Unknown"} ${customer?.last_name ?? ""}`,
      createdAt: c.created_at,
    };
  });
}

// Deliberately does NOT set authorized_at here -- the real guard
// already in the database (guard_recovery_authorization) only requires
// the authorize_recovery permission when authorized_at is actually
// being set, not on simple case creation. Matching that distinction
// rather than collapsing "flag a delinquent rental" and "authorize
// recovery action on it" into one step.
export async function openRecoveryCase(
  rentalId: string,
  customerId: string,
  balanceDue: number,
  authorizationReason: string
): Promise<{ success: boolean; error?: string; caseId?: string }> {
  if (!authorizationReason.trim()) {
    return { success: false, error: "A reason is required." };
  }

  const supabase = await createClient();
  const { data: rental } = await supabase.from("rental").select("tenant_id").eq("id", rentalId).single();
  if (!rental) return { success: false, error: "Rental not found." };

  const { data: segment } = await supabase
    .from("rental_segment")
    .select("vehicle_id")
    .eq("rental_id", rentalId)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!segment) return { success: false, error: "Couldn't find the vehicle for this rental." };

  const { data: newCase, error } = await supabase
    .from("recovery_case")
    .insert({
      tenant_id: rental.tenant_id,
      rental_id: rentalId,
      vehicle_id: segment.vehicle_id,
      customer_id: customerId,
      status: "delinquent",
      balance_due: balanceDue,
      authorization_reason: authorizationReason.trim(),
    })
    .select("id")
    .single();

  if (error || !newCase) {
    if (error?.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to open a recovery case." };
    }
    return { success: false, error: "Couldn't open a recovery case. Please try again." };
  }

  void logAuditEvent({
    tenantId: rental.tenant_id,
    action: "recovery_case_opened",
    entityType: "recovery_case",
    entityId: newCase.id,
    afterData: { rentalId, balanceDue, authorizationReason },
    source: "staff_portal",
  });

  revalidatePath("/staff/recovery");
  return { success: true, caseId: newCase.id };
}

// The actual authorization step -- requires authorize_recovery,
// enforced by the existing database guard the moment authorized_at is
// set, not by anything in this function itself.
export async function authorizeRecoveryCase(caseId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("recovery_case")
    .update({ status: "authorized", authorized_at: new Date().toISOString(), authorized_by: user?.id ?? null })
    .eq("id", caseId);

  if (error) {
    if (error.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to authorize recovery." };
    }
    return { success: false, error: "Couldn't authorize. Please try again." };
  }

  revalidatePath("/staff/recovery");
  revalidatePath(`/staff/recovery/${caseId}`);
  return { success: true };
}

export async function closeRecoveryCase(caseId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("recovery_case").update({ status: "closed" }).eq("id", caseId);
  if (error) return { success: false, error: "Couldn't close the case." };

  revalidatePath("/staff/recovery");
  revalidatePath(`/staff/recovery/${caseId}`);
  return { success: true };
}

export async function getRecoveryCaseDetail(caseId: string): Promise<RecoveryCaseDetail | null> {
  const supabase = await createClient();
  const { data: recoveryCase } = await supabase
    .from("recovery_case")
    .select(
      "id, status, balance_due, authorized_at, authorization_reason, rental_id, customer_id, created_at, customer:customer_id(first_name, last_name)"
    )
    .eq("id", caseId)
    .maybeSingle();

  if (!recoveryCase) return null;

  const { data: expenses } = await supabase
    .from("recovery_expense")
    .select("id, expense_type, amount, responsibility, approval_status")
    .eq("recovery_case_id", caseId)
    .order("id");

  const customer = recoveryCase.customer as unknown as { first_name: string; last_name: string } | null;

  return {
    id: recoveryCase.id,
    status: recoveryCase.status,
    balanceDue: Number(recoveryCase.balance_due ?? 0),
    authorizedAt: recoveryCase.authorized_at,
    authorizationReason: recoveryCase.authorization_reason,
    rentalId: recoveryCase.rental_id,
    customerId: recoveryCase.customer_id,
    customerName: `${customer?.first_name ?? "Unknown"} ${customer?.last_name ?? ""}`,
    createdAt: recoveryCase.created_at,
    expenses: (expenses ?? []).map((e) => ({
      id: e.id,
      expenseType: e.expense_type,
      amount: Number(e.amount),
      responsibility: e.responsibility,
      approvalStatus: e.approval_status,
    })),
  };
}

// No special permission required to LOG an expense -- matches the
// existing database guard exactly, which only gates the approval step
// (guard_recovery_expense_approval), not creation. Anyone handling a
// case can note a cost; only someone with approve_recovery_expense can
// turn it into a real charge against the deposit.
export async function addRecoveryExpense(
  caseId: string,
  expenseType: ExpenseType,
  amount: number,
  responsibility: "renter" | "company"
): Promise<{ success: boolean; error?: string }> {
  if (amount <= 0) return { success: false, error: "Enter a positive amount." };

  const supabase = await createClient();
  const { data: recoveryCase } = await supabase.from("recovery_case").select("tenant_id").eq("id", caseId).single();
  if (!recoveryCase) return { success: false, error: "Recovery case not found." };

  const { error } = await supabase.from("recovery_expense").insert({
    tenant_id: recoveryCase.tenant_id,
    recovery_case_id: caseId,
    expense_type: expenseType,
    amount,
    responsibility,
    approval_status: "pending",
  });

  if (error) return { success: false, error: "Couldn't add that expense. Please try again." };

  revalidatePath(`/staff/recovery/${caseId}`);
  return { success: true };
}

// Approving a recovery expense is what actually turns it into a charge
// against the deposit -- this is the entire point of the feature. The
// expense's own approval_status update is gated by the existing
// database guard (approve_recovery_expense); once that succeeds, this
// creates the charge (deposit-linked, tagged back to the expense via
// source_recovery_expense_id) and reuses the EXISTING approveCharge()
// logic directly rather than re-implementing deposit deduction,
// invoice-skip-on-deposit-deduction, and audit logging a second time.
export async function approveRecoveryExpense(expenseId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: expense } = await supabase
    .from("recovery_expense")
    .select("id, tenant_id, recovery_case_id, expense_type, amount, responsibility")
    .eq("id", expenseId)
    .single();
  if (!expense) return { success: false, error: "Expense not found." };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error: approveError } = await supabase
    .from("recovery_expense")
    .update({ approval_status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", expenseId);

  if (approveError) {
    if (approveError.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to approve recovery expenses." };
    }
    return { success: false, error: "Couldn't approve that expense." };
  }

  const { data: recoveryCase } = await supabase
    .from("recovery_case")
    .select("rental_id, customer_id")
    .eq("id", expense.recovery_case_id)
    .single();
  if (!recoveryCase) return { success: false, error: "Couldn't find the related recovery case." };

  const { data: deposit } = await supabase
    .from("deposit")
    .select("id, refundable_amount")
    .eq("rental_id", recoveryCase.rental_id)
    .eq("status", "held")
    .maybeSingle();

  const { data: newCharge, error: chargeError } = await supabase
    .from("charge")
    .insert({
      tenant_id: expense.tenant_id,
      rental_id: recoveryCase.rental_id,
      customer_id: recoveryCase.customer_id,
      charge_type: expense.expense_type,
      amount: expense.amount,
      responsibility: expense.responsibility,
      approval_status: "pending",
      deposit_id: deposit?.id ?? null,
      source_recovery_expense_id: expenseId,
    })
    .select("id")
    .single();

  if (chargeError || !newCharge) {
    return { success: false, error: "Expense approved, but couldn't create the linked charge. Please check /staff/charges." };
  }

  const chargeResult = await approveCharge(newCharge.id);
  if (!chargeResult.success) {
    return { success: false, error: `Expense approved, charge created, but approval failed: ${chargeResult.error}` };
  }

  revalidatePath(`/staff/recovery/${expense.recovery_case_id}`);
  return { success: true };
}
