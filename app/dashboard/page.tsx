import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./sign-out-button";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Everything below relies entirely on RLS (migrations 0014-0017) to scope
  // results to this user's tenant. No manual `where tenant_id = ...` is
  // written here on purpose -- if RLS is ever misconfigured, these queries
  // should return nothing rather than someone else's data, which is the
  // correct failure mode.
  const [{ data: membership }, { data: vehicleCategories }, { data: gigPlatforms }] =
    await Promise.all([
      supabase
        .from("membership")
        .select("tenant:tenant_id(name, slug), role:role_id(name)")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase.from("vehicle_category").select("name, description"),
      supabase.from("gig_platform").select("name, code").order("sort_order"),
    ]);

  const tenant = (membership?.tenant as any) ?? null;
  const role = (membership?.role as any) ?? null;

  return (
    <div style={{ maxWidth: 720, margin: "48px auto", padding: "0 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, marginBottom: 4 }}>
            {tenant ? tenant.name : "No tenant found"}
          </h1>
          <p className="muted-text">
            Signed in as {user.email} {role ? `— role: ${role.name}` : "(no role assigned)"}
          </p>
        </div>
        <SignOutButton />
      </div>

      {!membership && (
        <div className="card" style={{ borderColor: "var(--error)", marginBottom: 24 }}>
          <p className="error-text">
            No membership row found for this user. Either the account isn&apos;t linked to a
            tenant yet, or RLS is correctly hiding data that doesn&apos;t belong to you — both
            look identical from here, which is the point.
          </p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Vehicle categories</h2>
        {vehicleCategories && vehicleCategories.length > 0 ? (
          <ul>
            {vehicleCategories.map((c) => (
              <li key={c.name}>
                <strong>{c.name}</strong> — {c.description}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-text">None yet.</p>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Gig platform options</h2>
        {gigPlatforms && gigPlatforms.length > 0 ? (
          <ul>
            {gigPlatforms.map((p) => (
              <li key={p.code}>{p.name}</li>
            ))}
          </ul>
        ) : (
          <p className="muted-text">None found — check that migration 0017 ran.</p>
        )}
      </div>
    </div>
  );
}
