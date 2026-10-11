"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "./data";

export type CostInput = {
  vehicleId: string;
  purchasePrice: string;
  purchasedOn: string;
  monthlyLoan: string;
  monthlyInsurance: string;
  monthlyOther: string;
  managementFee: string;
  partnerSharePct: string;
};

/** Blank means 0 (or "not entered" for the price). Returns null for anything that isn't a sensible non-negative number. */
function money(v: string, max = 10_000_000): number | null {
  const t = v.trim().replace(/[$,]/g, "");
  if (t === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n <= max ? n : null;
}

/** Admin only. The database enforces the same rule; this gives a clear message first. */
export async function saveVehicleCost(input: CostInput): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  if (!(await isAdmin(supabase))) return { success: false, error: "Only the owner can change costs." };

  const price = input.purchasePrice.trim() === "" ? null : money(input.purchasePrice);
  const loan = money(input.monthlyLoan, 100_000);
  const insurance = money(input.monthlyInsurance, 100_000);
  const other = money(input.monthlyOther, 100_000);
  const fee = money(input.managementFee, 100_000);
  const share = money(input.partnerSharePct, 100);
  if ((input.purchasePrice.trim() !== "" && price === null) || loan === null || insurance === null || other === null || fee === null || share === null) {
    return { success: false, error: "Enter amounts as plain numbers like 350 or 1200.50 (partner share is 0 to 100)." };
  }
  const date = input.purchasedOn.trim();
  if (date !== "" && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()))) {
    return { success: false, error: "Purchase date isn’t valid." };
  }

  const { data: vehicle } = await supabase.from("vehicle").select("id, tenant_id").eq("id", input.vehicleId).maybeSingle();
  if (!vehicle) return { success: false, error: "Couldn’t find that vehicle." };

  const { error } = await supabase.from("vehicle_cost").upsert({
    vehicle_id: vehicle.id,
    tenant_id: vehicle.tenant_id,
    purchase_price: price,
    purchased_on: date === "" ? null : date,
    monthly_loan: loan,
    monthly_insurance: insurance,
    monthly_other: other,
    management_fee_monthly: fee,
    partner_share_pct: share,
    updated_at: new Date().toISOString(),
  });
  if (error) return { success: false, error: "Couldn’t save. Please try again." };

  revalidatePath("/staff/business");
  return { success: true };
}
