import { getRecoveryCases, getDelinquentRentalOptions } from "./actions";
import RecoveryList from "./recovery-list";

export const dynamic = "force-dynamic";

export default async function RecoveryPage() {
  const [cases, rentalOptions] = await Promise.all([getRecoveryCases(), getDelinquentRentalOptions()]);

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Recovery</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Delinquent rentals and recovery-related costs (tolls, tickets, cleaning, fuel shortage,
        storage) chargeable against the security deposit once approved.
      </p>
      <RecoveryList initialCases={cases} rentalOptions={rentalOptions} />
    </div>
  );
}
