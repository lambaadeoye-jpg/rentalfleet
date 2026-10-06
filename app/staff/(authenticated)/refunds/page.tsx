import { getRefunds } from "./actions";
import RefundsList from "./refunds-list";

export const dynamic = "force-dynamic";

export default async function RefundsPage() {
  const refunds = await getRefunds();
  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Refunds</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Refunds from rentals cancelled before pickup. Each one is calculated from your approved cancellation rules.
        Approving sends the money back to the renter&apos;s original card. Refunds over the approval limit need an admin.
      </p>
      <RefundsList refunds={refunds} />
    </div>
  );
}
