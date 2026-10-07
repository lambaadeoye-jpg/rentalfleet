import { getBilling } from "./actions";
import Link from "next/link";
import BillingList from "./billing-list";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const { rows, billingOn } = await getBilling();
  return (
    <div className="page">
      <h1 className="page-title">Weekly billing</h1>
      <p className="muted-text" style={{ marginBottom: 12 }}>
        Each active rental&rsquo;s saved card is charged automatically when a week of rent comes due. A declined card is retried up to four times
        (at the due time, then 1, 2 and 4 days later); after the last failure the rental is flagged for follow-up, and the flag clears by itself when a later charge succeeds. When a renter saves a new card, the failed charge is retried straight away on it (one extra try), and the row shows when the new card was saved. Nothing is suspended automatically.
      </p>
      <p style={{ marginBottom: 20, fontWeight: 600 }}>
        {billingOn ? (
          "Automatic charging is on."
        ) : (
          <>
            Automatic charging is off. Turn it on in{" "}
            <Link href="/staff/settings#automation-switches" style={{ color: "var(--teal-dark)", textDecoration: "underline" }}>
              Settings → Automation switches
            </Link>{" "}
            when you&rsquo;re ready.
          </>
        )}
      </p>
      <BillingList rows={rows} />
    </div>
  );
}
