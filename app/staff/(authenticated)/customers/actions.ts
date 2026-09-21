"use server";

import { createClient } from "@/lib/supabase/server";

export type CustomerListItem = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
};

export async function searchCustomers(query: string): Promise<CustomerListItem[]> {
  const supabase = await createClient();
  let q = supabase
    .from("customer")
    .select("id, first_name, last_name, email, phone, status")
    .order("created_at", { ascending: false })
    .limit(50);

  if (query.trim()) {
    q = q.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`);
  }

  const { data } = await q;
  return (data ?? []).map((c) => ({
    id: c.id,
    firstName: c.first_name,
    lastName: c.last_name,
    email: c.email,
    phone: c.phone,
    status: c.status,
  }));
}
