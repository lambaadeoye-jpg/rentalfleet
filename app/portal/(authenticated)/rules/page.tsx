import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadRuleValues } from "@/lib/handover-server";
import { briefingRules } from "@/lib/rental-rules";

export const dynamic = "force-dynamic";

export default async function PortalRulesPage() {
  const supabase = await createClient();
  // A renter only sees this once they have a rental on file.
  const { data: rental } = await supabase.from("rental").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const admin = createAdminClient();

  if (!rental || !admin) {
    return (
      <div style={{ padding: "24px 20px" }}>
        <h1 className="page-title" style={{ marginBottom: 12 }}>Rental rules</h1>
        <p className="muted-text">Your rules will show here once you have a rental.</p>
      </div>
    );
  }
  const rules = briefingRules(await loadRuleValues(admin));

  return (
    <div style={{ padding: "24px 20px" }}>
      <h1 className="page-title" style={{ marginBottom: 6 }}>Rental rules</h1>
      <p className="muted-text" style={{ marginBottom: 16, fontSize: 14 }}>A summary of what we went over at pickup. Your signed agreement controls.</p>
      {rules.map((r) => (
        <div key={r.id} className="card" style={{ marginBottom: 10 }}>
          <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{r.title}</p>
          <p style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>{r.text}</p>
        </div>
      ))}
    </div>
  );
}
