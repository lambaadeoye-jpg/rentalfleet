import { getTolls } from "./actions";
import TollsView from "./tolls-view";

export const dynamic = "force-dynamic";

export default async function TollsPage() {
  const { rows, vehicles, needsMigration, watch, threshold, payHours } = await getTolls();

  return (
    <div className="page">
      <h1 className="page-title">Tolls &amp; citations</h1>
      {needsMigration ? (
        <div className="card" style={{ maxWidth: 600 }}>
          <h2 className="card-title card-title--tight">One database update needed</h2>
          <p className="muted-text">This page needs migration 0093 to be run in Supabase. Run it in the SQL editor, then refresh.</p>
        </div>
      ) : (
        <>
          <p className="muted-text" style={{ marginBottom: 20 }}>
            Log each toll or ticket against the car. “Charge renter” sends one charge to the Charges page for approval: a flat $6 for a toll, or the
            fine plus the administrative fee for a ticket. The renter has {payHours} hours to pay; mark it paid when they have. A renter with more than {threshold} tickets is flagged.
          </p>
          <TollsView rows={rows} vehicles={vehicles} watch={watch} threshold={threshold} payHours={payHours} />
        </>
      )}
    </div>
  );
}
