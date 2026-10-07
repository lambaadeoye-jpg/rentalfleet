import Link from "next/link";
import { getRefunds, getDepositsDue } from "./actions";
import RefundsList from "./refunds-list";

export const dynamic = "force-dynamic";

export default async function RefundsPage() {
  const [refunds, due] = await Promise.all([getRefunds(), getDepositsDue()]);
  return (
    <div className="page">
      <h1 className="page-title">Refunds</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Refunds from rentals cancelled before pickup. Each one is calculated from your approved cancellation rules.
        Approving sends the money back to the renter&rsquo;s original card. Refunds over the approval limit need an admin.
      </p>
      {due.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 className="card-title card-title--tight">Deposits waiting to be returned</h2>
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>These vehicles are back. Open the application to review deductions and return the deposit.</p>
          {due.map((d) => (
            <div key={d.rentalId} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid rgba(128,128,128,0.25)" }}>
              <span>{d.customerName} · ${(d.refundableCents / 100).toFixed(2)} refundable{d.refundableCents < d.heldCents ? ` (of $${(d.heldCents / 100).toFixed(2)})` : ""}</span>
              {d.applicationId ? <Link href={`/staff/applications/${d.applicationId}`} style={{ color: "var(--teal)" }}>Open</Link> : <span className="muted-text">No application on file</span>}
            </div>
          ))}
        </div>
      )}
      <RefundsList refunds={refunds} />
    </div>
  );
}
