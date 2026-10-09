import { getTolls } from "./actions";
import TollsView from "./tolls-view";

export const dynamic = "force-dynamic";

export default async function TollsPage() {
  const { rows, vehicles, needsMigration } = await getTolls();

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
            Log each toll or ticket against the car. “Charge renter” adds the administrative fee from the rental agreement ($6 per toll, $25 per ticket) and
            sends one charge to the Charges page for approval.
          </p>
          <TollsView rows={rows} vehicles={vehicles} />
        </>
      )}
    </div>
  );
}
