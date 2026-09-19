import { createClient } from "@/lib/supabase/server";
import InsuranceTable from "./insurance-table";

export const dynamic = "force-dynamic";

export default async function InsurancePage() {
  const supabase = await createClient();

  // No manual tenant_id filtering -- RLS (0014) scopes this to the
  // signed-in staff member's own tenant. Renter policies only (policy_type
  // = 'renter') -- this monitor is specifically about the question raised
  // in conversation: is the RENTER's own insurance verified, not the
  // vehicle's own Bonzah coverage, which is a separate concern.
  const { data: policies } = await supabase
    .from("insurance_policy")
    .select(
      "id, provider, policy_reference, effective_to, verification_status, verified_at, customer:customer_id(first_name, last_name)"
    )
    .eq("policy_type", "renter")
    .order("created_at", { ascending: false });

  const rows = (policies ?? []).map((p) => ({
    ...p,
    customerName: `${(p.customer as any)?.first_name ?? ""} ${(p.customer as any)?.last_name ?? ""}`.trim() || "—",
  }));

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Insurance</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Renter insurance verification status. {rows.length} on file.
      </p>
      <InsuranceTable rows={rows} />
    </div>
  );
}
