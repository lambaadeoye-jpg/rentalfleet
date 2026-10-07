import { getBilling } from "./actions";
import BillingList from "./billing-list";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const { rows, billingOn } = await getBilling();
  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Weekly billing</h1>
      <p className="muted-text" style={{ marginBottom: 12 }}>
        Each active rental&apos;s saved card is charged automatically when a week of rent comes due. A declined card is retried up to four times
        (at the due time, then 1, 2 and 4 days later); after the last failure the rental is flagged for follow-up. Nothing is suspended automatically.
      </p>
      <p style={{ marginBottom: 20, fontWeight: 600 }}>
        {billingOn ? "Automatic charging is ON." : "Automatic charging is OFF. Turn it on in Settings → Automation switches when you're ready."}
      </p>
      <BillingList rows={rows} />
    </div>
  );
}
