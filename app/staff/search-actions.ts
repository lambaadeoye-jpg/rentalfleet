"use server";

import { createClient } from "@/lib/supabase/server";

export type SearchResult = {
  type: "customer" | "lead" | "application";
  id: string;
  label: string;
  sublabel: string;
  href: string;
};

// Global search across customers, leads, and applications -- real gap
// this closes: finding a specific person previously meant knowing which
// of three separate pages to check and scrolling/filtering manually.
export async function globalSearch(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const supabase = await createClient();
  const pattern = `%${trimmed}%`;

  const [{ data: customers }, { data: leads }, { data: applications }] = await Promise.all([
    supabase
      .from("customer")
      .select("id, first_name, last_name, email, phone")
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
      .limit(8),
    supabase
      .from("lead")
      .select("id, first_name, last_name, phone, stage")
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},phone.ilike.${pattern}`)
      .limit(5),
    supabase
      .from("application")
      .select("id, status, customer:customer_id(first_name, last_name)")
      .limit(30), // small tenant, filter client-side below rather than a fragile nested-column ilike
  ]);

  const results: SearchResult[] = [];

  for (const c of customers ?? []) {
    results.push({
      type: "customer",
      id: c.id,
      label: `${c.first_name} ${c.last_name}`,
      sublabel: c.email ?? c.phone ?? "",
      href: `/staff/customers/${c.id}`,
    });
  }

  for (const l of leads ?? []) {
    results.push({
      type: "lead",
      id: l.id,
      label: `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Unnamed lead",
      sublabel: `Lead — ${l.stage} — ${l.phone ?? ""}`,
      href: `/staff/leads`,
    });
  }

  const lowerQuery = trimmed.toLowerCase();
  for (const a of applications ?? []) {
    const customer = a.customer as any;
    const name = `${customer?.first_name ?? ""} ${customer?.last_name ?? ""}`.trim();
    if (name.toLowerCase().includes(lowerQuery)) {
      results.push({
        type: "application",
        id: a.id,
        label: name || "Unnamed applicant",
        sublabel: `Application — ${a.status}`,
        href: `/staff/applications/${a.id}`,
      });
    }
  }

  return results.slice(0, 15);
}
