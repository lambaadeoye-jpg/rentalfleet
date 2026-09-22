"use server";

import { createClient } from "@/lib/supabase/server";

// Real gap named explicitly in your own spec ("Data export must support
// customers, vehicles, bookings, rentals, payments, charges, invoices,
// documents and reports") but never built. Scoped to what's actually
// real right now -- invoices don't exist without a payment processor,
// and "reports" isn't a single exportable table. CSV generated
// server-side, returned as text for the client to download as a Blob.

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (val: unknown) => {
    const str = val === null || val === undefined ? "" : String(val);
    return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))];
  return lines.join("\n");
}

export async function exportCustomers(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("customer").select("id, first_name, last_name, email, phone, status, created_at").order("created_at");
  return toCsv(data ?? []);
}

export async function exportVehicles(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vehicle")
    .select("id, vin, make, model, year, plate, mileage, status, ownership_type, created_at")
    .order("created_at");
  return toCsv(data ?? []);
}

export async function exportBookings(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("booking")
    .select("id, customer_id, category_id, pickup_at, return_at, status, quoted_amount, created_at")
    .order("created_at");
  return toCsv(data ?? []);
}

export async function exportRentals(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rental")
    .select("id, customer_id, status, start_at, expected_return_at, actual_return_at, created_at")
    .order("created_at");
  return toCsv(data ?? []);
}

export async function exportPayments(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payment")
    .select("id, rental_id, customer_id, method_type, amount, currency, status, paid_at")
    .order("paid_at", { ascending: false, nullsFirst: false });
  return toCsv(data ?? []);
}

export async function exportCharges(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("charge")
    .select("id, rental_id, customer_id, charge_type, amount, responsibility, approval_status, created_at")
    .order("created_at", { ascending: false });
  return toCsv(data ?? []);
}
