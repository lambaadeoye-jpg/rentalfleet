"use server";

import { createClient } from "@/lib/supabase/server";
import { safeSearchTerm, phoneDigits } from "@/lib/search-term";

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

  const term = safeSearchTerm(typeof query === "string" ? query : "");
  if (term) {
    const digits = phoneDigits(term);
    q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${digits || term}%`);
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
