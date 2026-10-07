import { getMarketingSettings } from "./actions";
import MarketingSettingsForm from "./marketing-settings-form";
import Link from "next/link";
import PickupSchedulingForm from "./pickup-scheduling-form";
import PaymentSettingsForm from "./payment-settings-form";
import SwitchSettingsForm from "./switch-settings-form";
import { getSwitches } from "./switch-settings-actions";
import { getPaymentSettings } from "./payment-settings-actions";
import { getPickupScheduling } from "./pickup-actions";

export const dynamic = "force-dynamic";

export default async function MarketingSettingsPage() {
  const settings = await getMarketingSettings();
  const pickup = await getPickupScheduling();
  const payments = await getPaymentSettings();
  const switches = await getSwitches();

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Marketing Settings</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        These feed the pickup review-request text/email directly -- no need to edit anything in
        n8n when you start a new Facebook ad campaign.
      </p>
      <MarketingSettingsForm initialGoogleUrl={settings.googleReviewUrl} initialFacebookUrl={settings.facebookAdUrl} />
      <PickupSchedulingForm initial={pickup} />
      <PaymentSettingsForm initial={payments} />
      <SwitchSettingsForm initial={switches} />
      <div className="card" style={{ maxWidth: 720, marginTop: 28 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>Rental agreement</h2>
        <p className="muted-text" style={{ fontSize: 13, marginBottom: 12 }}>The text renters sign, its versions, and approval.</p>
        <Link href="/staff/settings/agreement" className="button-secondary" style={{ display: "inline-flex" }}>Open agreement text</Link>
      </div>
    </div>
  );
}
