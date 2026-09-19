import { createClient } from "@/lib/supabase/server";
import LeadsTable from "./leads-table";
import { LEAD_STAGES } from "./constants";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const supabase = await createClient();

  // No manual tenant_id filtering -- RLS (0014) scopes this to the
  // signed-in staff member's own tenant automatically.
  const { data: leads } = await supabase
    .from("lead")
    .select("id, first_name, last_name, email, phone, stage, source, created_at")
    .order("created_at", { ascending: false });

  const { data: platformLinks } = await supabase
    .from("lead_gig_platform")
    .select("lead_id, gig_platform:gig_platform_id(name)");

  const platformsByLead = new Map<string, string[]>();
  for (const link of platformLinks ?? []) {
    const name = (link.gig_platform as any)?.name;
    if (!name) continue;
    const list = platformsByLead.get(link.lead_id) ?? [];
    list.push(name);
    platformsByLead.set(link.lead_id, list);
  }

  const leadsWithPlatforms = (leads ?? []).map((lead) => ({
    ...lead,
    platforms: platformsByLead.get(lead.id) ?? [],
  }));

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Leads</h1>
      <p className="muted-text" style={{ marginBottom: 28 }}>
        {leadsWithPlatforms.length} total. Move a lead through the pipeline as you work it.
      </p>
      <LeadsTable leads={leadsWithPlatforms} stages={[...LEAD_STAGES]} />
    </div>
  );
}
