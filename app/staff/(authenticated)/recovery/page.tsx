import { getRecoveryCases, getDelinquentRentalOptions } from "./actions";
import RecoveryList from "./recovery-list";

export const dynamic = "force-dynamic";

export default async function RecoveryPage() {
  const [cases, rentalOptions] = await Promise.all([getRecoveryCases(), getDelinquentRentalOptions()]);

  return (
    <div className="page">
      <h1 className="page-title">Recovery</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Delinquent rentals and recovery-related costs (tolls, tickets, cleaning, fuel shortage,
        storage) chargeable against the security deposit once approved.
      </p>
      <RecoveryList initialCases={cases} rentalOptions={rentalOptions} />
    </div>
  );
}
