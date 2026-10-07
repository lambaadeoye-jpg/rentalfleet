import { getCharges, getActiveRentalsForCharging } from "./actions";
import ChargesList from "./charges-list";

export const dynamic = "force-dynamic";

export default async function ChargesPage() {
  const [charges, rentals] = await Promise.all([getCharges(), getActiveRentalsForCharging()]);

  return (
    <div className="page">
      <h1 className="page-title">Charges</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Tolls, tickets, cleaning, damage, or anything else billed to a renter. Every charge needs
        approval before it’s real — deductible charges reduce the deposit directly on approval.
      </p>
      <ChargesList initialCharges={charges} rentals={rentals} />
    </div>
  );
}
