import { createClient } from "@/lib/supabase/server";
import { Car } from "lucide-react";
import { getAdditionalDrivers } from "@/app/apply/actions";
import PortalDriversManager from "./portal-drivers-manager";

export const dynamic = "force-dynamic";

export default async function PortalRentalPage() {
  const supabase = await createClient();

  const { data: customer } = await supabase.from("customer").select("id").maybeSingle();

  const { data: rental } = await supabase
    .from("rental")
    .select(
      "id, status, start_at, expected_return_at, governing_policy_snapshot, rental_segment(starts_at, vehicle:vehicle_id(make, model, year, plate, vin))"
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const additionalDrivers = customer ? await getAdditionalDrivers(customer.id) : [];

  const vehicle = (rental?.rental_segment as any)?.[0]?.vehicle;
  const policy = (rental?.governing_policy_snapshot as any) ?? {};

  if (!rental) {
    return (
      <div style={{ padding: "24px 20px" }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>My Rental</h1>
        <p className="muted-text">You don&apos;t have a rental on file yet.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 20px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>My Rental</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Car size={22} color="var(--teal)" />
          <span style={{ fontWeight: 700, fontSize: 16 }}>
            {vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "Vehicle"}
          </span>
        </div>
        {vehicle?.plate && (
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 2 }}>Plate: {vehicle.plate}</p>
        )}
        <span
          style={{
            display: "inline-block",
            marginTop: 8,
            background: "rgba(22,163,74,0.1)",
            color: "var(--signal-green, #16a34a)",
            fontSize: 12,
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: 999,
            textTransform: "capitalize",
          }}
        >
          {rental.status}
        </span>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Rental Period</h2>
        <p style={{ fontSize: 14, marginBottom: 4 }}>
          Started: {rental.start_at ? new Date(rental.start_at).toLocaleDateString() : "—"}
        </p>
        <p style={{ fontSize: 14 }}>
          Expected return: {rental.expected_return_at ? new Date(rental.expected_return_at).toLocaleDateString() : "—"}
        </p>
      </div>

      {(policy.weekly_rate_usd || policy.mileage_policy) && (
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Your Rate &amp; Policy</h2>
          {policy.weekly_rate_usd && (
            <p style={{ fontSize: 14, marginBottom: 4 }}>Weekly rate: ${policy.weekly_rate_usd}</p>
          )}
          {policy.mileage_policy && (
            <p style={{ fontSize: 14, textTransform: "capitalize" }}>Mileage: {policy.mileage_policy}</p>
          )}
        </div>
      )}

      {customer && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Other Drivers</h2>
          <PortalDriversManager customerId={customer.id} initialDrivers={additionalDrivers} />
        </div>
      )}
    </div>
  );
}
