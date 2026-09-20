import { getPricingRules } from "./actions";
import PricingForm from "./pricing-form";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const rules = await getPricingRules();

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Pricing</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Daily, weekly, and late fee rates. Historical rentals keep the exact rate that governed
        them at the time -- changes here only apply going forward.
      </p>
      {rules ? (
        <PricingForm initialRules={rules} />
      ) : (
        <p className="error-text">No active pricing policy found.</p>
      )}
    </div>
  );
}
