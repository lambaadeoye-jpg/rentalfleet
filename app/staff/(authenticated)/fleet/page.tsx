import { createClient } from "@/lib/supabase/server";
import AddVehicleForm from "./add-vehicle-form";
import FleetTable from "./fleet-table";

export const dynamic = "force-dynamic";

export default async function FleetPage() {
  const supabase = await createClient();

  // No manual tenant_id filtering -- RLS (0014) scopes both of these to
  // the signed-in staff member's own tenant automatically.
  const [{ data: vehicles }, { data: categories }] = await Promise.all([
    supabase
      .from("vehicle")
      .select("id, vin, make, model, year, plate, mileage, status, category:category_id(name)")
      .order("created_at", { ascending: false }),
    supabase.from("vehicle_category").select("id, name").eq("active", true),
  ]);

  const vehiclesWithCategory = (vehicles ?? []).map((v) => ({
    ...v,
    categoryName: (v.category as any)?.name ?? "—",
  }));

  return (
    <div style={{ padding: "32px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div>
          <h1 style={{ fontSize: 22, marginBottom: 4 }}>Fleet</h1>
          <p className="muted-text">{vehiclesWithCategory.length} vehicles.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <a href="/staff/fleet/categories" className="button-secondary" style={{ color: "var(--text)", borderColor: "var(--border)" }}>
            Categories
          </a>
          <a href="/staff/fleet/locations" className="button-secondary" style={{ color: "var(--text)", borderColor: "var(--border)" }}>
            Locations
          </a>
          <a href="/staff/fleet/maintenance" className="button-secondary" style={{ color: "var(--text)", borderColor: "var(--border)" }}>
            Maintenance
          </a>
          <a href="/staff/fleet/incidents" className="button-secondary" style={{ color: "var(--text)", borderColor: "var(--border)" }}>
            Incidents
          </a>
        </div>
      </div>

      <AddVehicleForm categories={categories ?? []} />

      <div style={{ marginTop: 24 }}>
        <FleetTable vehicles={vehiclesWithCategory} />
      </div>
    </div>
  );
}
