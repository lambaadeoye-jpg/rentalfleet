"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit-log";
import { currentUser } from "@/lib/staff-role";
import { APPROVAL_LIMIT_KEY, parseLimit, validateFinish, validateStart } from "@/lib/maintenance";

type Result = { success: boolean; error?: string; note?: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RunnerJob = {
  id: string;
  vehicle: string;
  status: string;
  workType: string | null;
  performedBy: string | null;
  shopName: string | null;
  paymentArrangement: string | null;
  cost: number | null;
  notes: string | null;
  receiptCount: number;
  startedAt: string | null;
};

export async function getRunnerMaintenance(): Promise<{ jobs: RunnerJob[]; cars: { id: string; label: string }[]; limit: number; needsMigration: boolean }> {
  const supabase = await createClient();
  const me = await currentUser(supabase);
  if (!me) return { jobs: [], cars: [], limit: parseLimit(null), needsMigration: false };

  const [{ data: rows, error }, { data: carRows }, { data: setting }] = await Promise.all([
    supabase
      .from("maintenance_work_order")
      .select("id, status, work_type, performed_by, shop_name, payment_arrangement, cost, notes, receipt_keys, downtime_start, vehicle:vehicle_id(year, make, model, plate)")
      .or(`created_by_user_id.eq.${me.id},assigned_runner_id.eq.${me.id}`)
      .order("downtime_start", { ascending: false, nullsFirst: false })
      .limit(40),
    supabase.from("vehicle").select("id, year, make, model, plate").eq("status", "available").order("created_at", { ascending: true }),
    supabase.from("tenant_setting").select("value").eq("key", APPROVAL_LIMIT_KEY).maybeSingle(),
  ]);
  if (error) return { jobs: [], cars: [], limit: parseLimit(null), needsMigration: true };

  const label = (v: any) => `${[v?.year, v?.make, v?.model].filter(Boolean).join(" ") || "Vehicle"}${v?.plate ? ` · ${v.plate}` : ""}`;
  return {
    jobs: (rows ?? []).map((w: any) => ({
      id: w.id,
      vehicle: label(w.vehicle),
      status: w.status,
      workType: w.work_type,
      performedBy: w.performed_by,
      shopName: w.shop_name,
      paymentArrangement: w.payment_arrangement,
      cost: w.cost != null ? Number(w.cost) : null,
      notes: w.notes,
      receiptCount: (w.receipt_keys ?? []).length,
      startedAt: w.downtime_start,
    })),
    cars: (carRows ?? []).map((v: any) => ({ id: v.id, label: label(v) })),
    limit: parseLimit(setting?.value ?? null),
    needsMigration: false,
  };
}

export async function startMaintenanceJob(input: {
  vehicleId: string;
  workType: string;
  performedBy: string;
  shopName: string;
  paymentArrangement: string;
  notes: string;
}): Promise<Result> {
  const check = validateStart(input);
  if (!check.ok) return { success: false, error: check.error };
  if (!UUID_RE.test(check.value.vehicleId)) return { success: false, error: "Something went wrong. Please try again." };

  const supabase = await createClient();
  const me = await currentUser(supabase);
  if (!me) return { success: false, error: "Not signed in." };

  // Only a car that is free right now. The database enforces this too.
  const { data: car } = await supabase.from("vehicle").select("id, tenant_id, status").eq("id", check.value.vehicleId).maybeSingle();
  if (!car) return { success: false, error: "Car not found." };
  if (car.status !== "available") return { success: false, error: "That car isn’t free right now (it may be rented or reserved). Ask the office." };

  const { data: job, error } = await supabase
    .from("maintenance_work_order")
    .insert({
      tenant_id: car.tenant_id,
      vehicle_id: car.id,
      status: "open",
      work_type: check.value.workType,
      notes: check.value.notes,
      downtime_start: new Date().toISOString(),
      created_by_user_id: me.id,
      performed_by: check.value.performedBy,
      shop_name: check.value.shopName,
      payment_arrangement: check.value.paymentArrangement,
    })
    .select("id")
    .single();
  if (error || !job) {
    if (error?.message?.toLowerCase().includes("permission")) return { success: false, error: "That car can’t be taken out of service right now. Ask the office." };
    return { success: false, error: "Couldn’t start that job. Please try again." };
  }

  const { error: carError } = await supabase.from("vehicle").update({ status: "maintenance" }).eq("id", car.id);
  if (carError) {
    return { success: true, note: "Job started, but the car’s status didn’t change. Tell the office so nobody books it." };
  }

  await logAuditEvent({ tenantId: car.tenant_id, action: "maintenance_job_started", entityType: "maintenance_work_order", entityId: job.id, afterData: { vehicleId: car.id, performedBy: check.value.performedBy }, source: "staff_portal" });
  revalidatePath("/staff/fleet/maintenance");
  revalidatePath("/staff/fleet");
  return { success: true };
}

export async function addMaintenanceReceipt(jobId: string, formData: FormData): Promise<Result> {
  if (!UUID_RE.test(jobId)) return { success: false, error: "Something went wrong. Please try again." };
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { success: false, error: "Choose a photo first." };
  if (file.size > 10 * 1024 * 1024) return { success: false, error: "Photo is too large (max 10MB)." };
  if (!/^image\/|^application\/pdf$/.test(file.type)) return { success: false, error: "Use a photo or a PDF." };

  const supabase = await createClient();
  const { data: job } = await supabase.from("maintenance_work_order").select("id, tenant_id, status, receipt_keys").eq("id", jobId).maybeSingle();
  if (!job) return { success: false, error: "Job not found." };
  if (job.status !== "open") return { success: false, error: "This job is already sent to the office." };

  const safe = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-80);
  const path = `${job.tenant_id}/${job.id}/${Date.now()}_${safe}`;
  const { error: upErr } = await supabase.storage.from("maintenance-receipts").upload(path, file, { upsert: false });
  if (upErr) return { success: false, error: "Upload failed. Please try again." };

  const { error } = await supabase.from("maintenance_work_order").update({ receipt_keys: [...(job.receipt_keys ?? []), path] }).eq("id", jobId);
  if (error) return { success: false, error: "Photo uploaded but couldn’t be saved. Please try again." };

  revalidatePath("/staff/fleet/maintenance");
  return { success: true };
}

/**
 * Finishes a job. At or under the spending limit the car goes straight back to available;
 * over it, the job waits for an admin and the car stays out of service.
 */
export async function finishMaintenanceJob(jobId: string, costText: string, closingNotes: string): Promise<Result> {
  if (!UUID_RE.test(jobId)) return { success: false, error: "Something went wrong. Please try again." };
  const supabase = await createClient();

  const [{ data: job }, { data: setting }] = await Promise.all([
    supabase.from("maintenance_work_order").select("id, tenant_id, vehicle_id, status, payment_arrangement, receipt_keys, notes").eq("id", jobId).maybeSingle(),
    supabase.from("tenant_setting").select("value").eq("key", APPROVAL_LIMIT_KEY).maybeSingle(),
  ]);
  if (!job) return { success: false, error: "Job not found." };
  if (job.status !== "open") return { success: false, error: "This job is already finished or with the office." };

  const check = validateFinish({
    costText,
    paymentArrangement: job.payment_arrangement,
    receiptCount: (job.receipt_keys ?? []).length,
    limit: parseLimit(setting?.value ?? null),
  });
  if (!check.ok) return { success: false, error: check.error };

  const now = new Date().toISOString();
  const extra = closingNotes.trim().slice(0, 500);
  const notes = extra ? [job.notes, extra].filter(Boolean).join("\n") : job.notes;
  const update =
    check.outcome === "completed"
      ? { status: "completed", cost: check.cost, downtime_end: now, notes }
      : { status: "pending_approval", cost: check.cost, submitted_at: now, notes };

  const { error } = await supabase.from("maintenance_work_order").update(update).eq("id", jobId);
  if (error) return { success: false, error: "Couldn’t save that. Please try again." };

  if (check.outcome === "completed") {
    const { error: carError } = await supabase.from("vehicle").update({ status: "available" }).eq("id", job.vehicle_id);
    if (carError) return { success: true, note: "Job saved, but the car’s status didn’t update. Tell the office." };
  }

  await logAuditEvent({ tenantId: job.tenant_id, action: check.outcome === "completed" ? "maintenance_job_completed" : "maintenance_job_submitted", entityType: "maintenance_work_order", entityId: jobId, afterData: { cost: check.cost }, source: "staff_portal" });
  revalidatePath("/staff/fleet/maintenance");
  revalidatePath("/staff/fleet");
  return check.outcome === "completed"
    ? { success: true, note: "Done. The car is back on the lot as available." }
    : { success: true, note: "Sent to the office for approval because it’s over the limit. The car stays out of service until they approve." };
}
