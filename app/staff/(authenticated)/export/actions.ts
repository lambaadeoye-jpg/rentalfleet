"use server";

import { createClient } from "@/lib/supabase/server";
import { currentRoleName } from "@/lib/staff-role";
import { toCsv } from "@/lib/csv";
import { logAuditEvent } from "@/lib/audit-log";

// CSV generated server-side, returned as text for the client to download.
// Office only: exports hold customer contact details and payment history, so a
// runner account must not be able to call these directly. Rows are read in
// pages (the database returns at most 1,000 per request) so nothing is cut off.

type Db = Awaited<ReturnType<typeof createClient>>;
type Page = { data: Record<string, unknown>[] | null; error: { message: string } | null };

const PAGE = 1000;
const MAX_ROWS = 50000;

async function exportTable(
  name: string,
  headers: string[],
  build: (supabase: Db) => (from: number, to: number) => PromiseLike<Page>
): Promise<string> {
  const supabase = await createClient();
  const role = await currentRoleName(supabase);
  if (role !== "admin") throw new Error("Only the office can export data.");

  const page = build(supabase);
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error("Couldn’t read the data for this export.");
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  // Exports of customer and payment data leave a trail. The tenant comes from the signed-in staff member's own membership.
  const { data: { user } } = await supabase.auth.getUser();
  const { data: member } = user ? await supabase.from("membership").select("tenant_id").eq("user_id", user.id).limit(1).maybeSingle() : { data: null };
  if (member?.tenant_id) {
    await logAuditEvent({ tenantId: member.tenant_id, action: "data_exported", entityType: "export", entityId: member.tenant_id, afterData: { table: name, rows: rows.length }, source: "staff_portal" });
  }
  return toCsv(rows, headers);
}

export async function exportCustomers(): Promise<string> {
  const headers = ["id", "first_name", "last_name", "email", "phone", "status", "created_at"];
  return exportTable("customer", headers, (s) => (from, to) =>
    s.from("customer").select(headers.join(", ")).order("created_at").order("id").range(from, to) as unknown as PromiseLike<Page>);
}

export async function exportVehicles(): Promise<string> {
  const headers = ["id", "vin", "make", "model", "year", "plate", "mileage", "status", "ownership_type", "created_at"];
  return exportTable("vehicle", headers, (s) => (from, to) =>
    s.from("vehicle").select(headers.join(", ")).order("created_at").order("id").range(from, to) as unknown as PromiseLike<Page>);
}

export async function exportBookings(): Promise<string> {
  const headers = ["id", "customer_id", "category_id", "pickup_at", "return_at", "status", "quoted_amount", "created_at"];
  return exportTable("booking", headers, (s) => (from, to) =>
    s.from("booking").select(headers.join(", ")).order("created_at").order("id").range(from, to) as unknown as PromiseLike<Page>);
}

export async function exportRentals(): Promise<string> {
  const headers = ["id", "customer_id", "status", "start_at", "expected_return_at", "actual_return_at", "created_at"];
  return exportTable("rental", headers, (s) => (from, to) =>
    s.from("rental").select(headers.join(", ")).order("created_at").order("id").range(from, to) as unknown as PromiseLike<Page>);
}

export async function exportPayments(): Promise<string> {
  const headers = ["id", "rental_id", "customer_id", "method_type", "amount", "currency", "status", "paid_at"];
  return exportTable("payment", headers, (s) => (from, to) =>
    s.from("payment").select(headers.join(", ")).order("paid_at", { ascending: false, nullsFirst: false }).order("id").range(from, to) as unknown as PromiseLike<Page>);
}

export async function exportCharges(): Promise<string> {
  const headers = ["id", "rental_id", "customer_id", "charge_type", "amount", "responsibility", "approval_status", "created_at"];
  return exportTable("charge", headers, (s) => (from, to) =>
    s.from("charge").select(headers.join(", ")).order("created_at", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<Page>);
}
