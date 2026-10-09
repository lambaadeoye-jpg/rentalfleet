"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentRoleName } from "@/lib/staff-role";
import { logAuditEvent } from "@/lib/audit-log";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Office only: choose which runner does this rental's handover and return. Pass null to unassign. */
export async function assignRunner(rentalId: string, runnerId: string | null): Promise<{ success: boolean; error?: string }> {
  if (!UUID_RE.test(rentalId) || (runnerId !== null && !UUID_RE.test(runnerId))) return { success: false, error: "Something went wrong. Please try again." };
  const supabase = await createClient();
  if ((await currentRoleName(supabase)) !== "admin") return { success: false, error: "Only an admin can assign runners." };

  if (runnerId) {
    const { data: member } = await supabase.from("membership").select("user_id, role:role_id(name)").eq("user_id", runnerId).maybeSingle();
    if (!member || (member.role as any)?.name !== "field_staff") return { success: false, error: "That person isn’t a field runner." };
  }

  const { data: rental } = await supabase.from("rental").select("id, tenant_id, status").eq("id", rentalId).maybeSingle();
  if (!rental) return { success: false, error: "Rental not found." };
  if (rental.status !== "scheduled" && rental.status !== "active") return { success: false, error: "Only upcoming or active rentals can be assigned." };

  const { error } = await supabase.from("rental").update({ assigned_runner_id: runnerId }).eq("id", rentalId);
  if (error) return { success: false, error: "Couldn’t save that. Please try again." };

  void logAuditEvent({
    tenantId: rental.tenant_id,
    action: "rental_runner_assigned",
    entityType: "rental",
    entityId: rentalId,
    afterData: { runnerId },
    source: "staff_portal",
  });
  revalidatePath("/staff/pickups");
  return { success: true };
}
