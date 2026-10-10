import { createClient } from "@/lib/supabase/server";
import { Car } from "lucide-react";
import { getAdditionalDrivers } from "@/app/apply/actions";
import PortalDriversManager from "./portal-drivers-manager";
import PickupSlotPicker from "./pickup-slot-picker";
import { getPickerState } from "./pickup-actions";
import PayNow from "./pay-now";
import SignNow from "./sign-now";
import { getPortalPayState, getMyWeeklyOffer } from "./payment-actions";
import WeeklyOffer from "./weekly-offer";
import CancelRental from "./cancel-rental";
import { getMyCancelState } from "./cancel-actions";
import { sentenceCase } from "@/lib/format-label";

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
  const pickerState = await getPickerState();
  const payState = await getPortalPayState();
  const cancelState = await getMyCancelState();
  const weeklyOffer = await getMyWeeklyOffer();

  const vehicle = (rental?.rental_segment as any)?.[0]?.vehicle;
  const policy = (rental?.governing_policy_snapshot as any) ?? {};

  if (!rental) {
    return (
      <div style={{ padding: "24px 20px" }}>
        <h1 className="page-title" style={{ marginBottom: 12 }}>My rental</h1>
        <p className="muted-text">You don&rsquo;t have a rental on file yet.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 20px" }}>
      <h1 className="page-title" style={{ marginBottom: 16 }}>My rental</h1>

      <a href="/portal/rules" className="card" style={{ marginBottom: 16, display: "block", textDecoration: "none", color: "inherit", fontWeight: 600 }}>
        Rental rules: fees, drivers, where you can drive →
      </a>

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
          }}
        >
          {sentenceCase(rental.status)}
        </span>
      </div>

      {payState.needsSignature && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 className="card-title card-title--tight">Sign your rental agreement</h2>
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>Read and sign it online. You&rsquo;ll need it signed before you can pay and pick up.</p>
          <SignNow />
        </div>
      )}

      {payState.show && !payState.needsSignature && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 className="card-title card-title--tight">Pay to lock in your rental</h2>
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>First week plus security deposit, paid by card on a secure Stripe page.</p>
          <PayNow />
        </div>
      )}

      {weeklyOffer.available && (
        <WeeklyOffer rate={weeklyOffer.rate} firstChargeAt={weeklyOffer.firstChargeAt} cardLast4={weeklyOffer.cardLast4}
          needsCard={weeklyOffer.needsCard} consent={weeklyOffer.consent} creditDays={weeklyOffer.creditDays} />
      )}

      <PickupSlotPicker state={pickerState} />

      {cancelState.canCancel && <CancelRental />}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 className="card-title">Rental period</h2>
        <p style={{ fontSize: 14, marginBottom: 4 }}>
          Started: {rental.start_at ? new Date(rental.start_at).toLocaleDateString() : "—"}
        </p>
        <p style={{ fontSize: 14 }}>
          Expected return: {rental.expected_return_at ? new Date(rental.expected_return_at).toLocaleDateString() : "—"}
        </p>
      </div>

      {(policy.weekly_rate_usd || policy.mileage_policy) && (
        <div className="card">
          <h2 className="card-title">Your rate &amp; policy</h2>
          {policy.weekly_rate_usd && (
            <p style={{ fontSize: 14, marginBottom: 4 }}>Weekly rate: ${policy.weekly_rate_usd}</p>
          )}
          {policy.mileage_policy && (
            <p style={{ fontSize: 14 }}>Mileage: {sentenceCase(policy.mileage_policy)}</p>
          )}
        </div>
      )}

      {customer && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 className="card-title">Other drivers</h2>
          <PortalDriversManager customerId={customer.id} initialDrivers={additionalDrivers} />
        </div>
      )}
    </div>
  );
}
