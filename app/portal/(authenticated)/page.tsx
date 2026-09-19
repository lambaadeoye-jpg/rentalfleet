import { createClient } from "@/lib/supabase/server";
import { Car, Wallet, FileText, LifeBuoy } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PortalDashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No manual customer_id filtering anywhere below -- RLS (0020) scopes
  // every one of these queries to the signed-in customer's own rows
  // automatically. A customer with no active rental correctly gets an
  // empty result, not an error.
  const { data: customer } = await supabase
    .from("customer")
    .select("first_name, last_name")
    .eq("auth_user_id", user!.id)
    .single();

  const { data: rental } = await supabase
    .from("rental")
    .select(
      "id, status, start_at, expected_return_at, rental_segment(vehicle:vehicle_id(make, model, year))"
    )
    .eq("status", "active")
    .maybeSingle();

  const vehicle = (rental?.rental_segment as any)?.[0]?.vehicle;

  return (
    <div style={{ padding: "24px 20px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>
        Good {new Date().getHours() < 12 ? "morning" : "afternoon"}, {customer?.first_name ?? "there"}.
      </h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Here&apos;s your rental and what needs your attention.
      </p>

      {rental ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontWeight: 700 }}>Your Rental</span>
            <span
              style={{
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
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>
            {vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "Vehicle assigned"}
          </p>
          <p className="muted-text" style={{ fontSize: 13 }}>
            Since {rental.start_at ? new Date(rental.start_at).toLocaleDateString() : "—"}
          </p>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="muted-text">You don&apos;t have an active rental yet.</p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <a href="/portal/rental" className="card" style={{ textDecoration: "none", color: "var(--text)" }}>
          <Car size={18} color="var(--teal)" style={{ marginBottom: 6 }} />
          <div style={{ fontSize: 13, fontWeight: 700 }}>My Rental</div>
        </a>
        <a href="/portal/money" className="card" style={{ textDecoration: "none", color: "var(--text)" }}>
          <Wallet size={18} color="var(--teal)" style={{ marginBottom: 6 }} />
          <div style={{ fontSize: 13, fontWeight: 700 }}>Money</div>
        </a>
        <a href="/portal/documents" className="card" style={{ textDecoration: "none", color: "var(--text)" }}>
          <FileText size={18} color="var(--teal)" style={{ marginBottom: 6 }} />
          <div style={{ fontSize: 13, fontWeight: 700 }}>Documents</div>
        </a>
        <a href="/portal/support" className="card" style={{ textDecoration: "none", color: "var(--text)" }}>
          <LifeBuoy size={18} color="var(--teal)" style={{ marginBottom: 6 }} />
          <div style={{ fontSize: 13, fontWeight: 700 }}>Support</div>
        </a>
      </div>
    </div>
  );
}
