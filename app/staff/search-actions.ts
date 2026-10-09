"use server";

import { createClient } from "@/lib/supabase/server";
import { safeSearchTerm, phoneDigits } from "@/lib/search-term";

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
  const term = safeSearchTerm(typeof query === "string" ? query : "");
  if (term.length < 2) return [];

  const supabase = await createClient();
  const pattern = `%${term}%`;
  const digits = phoneDigits(term);
  const phoneClause = digits ? `,phone.ilike.%${digits}%` : `,phone.ilike.${pattern}`;

  const [{ data: customers }, { data: leads }, { data: nameMatches }] = await Promise.all([
    supabase
      .from("customer")
      .select("id, first_name, last_name, email, phone")
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}${phoneClause}`)
      .limit(8),
    supabase
      .from("lead")
      .select("id, first_name, last_name, phone, stage")
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}${phoneClause}`)
      .limit(5),
    supabase
      .from("customer")
      .select("id")
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
      .limit(40),
  ]);

  const ids = (nameMatches ?? []).map((c) => c.id);
  const { data: applications } = ids.length
    ? await supabase
        .from("application")
        .select("id, status, customer:customer_id(first_name, last_name)")
        .in("customer_id", ids)
        .order("created_at", { ascending: false })
        .limit(8)
    : { data: [] as { id: string; status: string; customer: unknown }[] };

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

  for (const a of applications ?? []) {
    const customer = a.customer as any;
    const name = `${customer?.first_name ?? ""} ${customer?.last_name ?? ""}`.trim();
    results.push({
      type: "application",
      id: a.id,
      label: name || "Unnamed applicant",
      sublabel: `Application — ${a.status}`,
      href: `/staff/applications/${a.id}`,
    });
  }

  return results.slice(0, 15);
}
