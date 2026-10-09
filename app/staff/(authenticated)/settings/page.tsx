import { getMarketingSettings } from "./actions";
import MarketingSettingsForm from "./marketing-settings-form";
import Link from "next/link";
import PickupSchedulingForm from "./pickup-scheduling-form";
import PaymentSettingsForm from "./payment-settings-form";
import SwitchSettingsForm from "./switch-settings-form";
import { getSwitches } from "./switch-settings-actions";
import { getPaymentSettings } from "./payment-settings-actions";
import { getPickupScheduling } from "./pickup-actions";
import RulesSettingsForm from "./rules-settings-form";
import { getRulesSettings } from "./rules-settings-actions";

export const dynamic = "force-dynamic";

export default async function MarketingSettingsPage() {
  const settings = await getMarketingSettings();
  const pickup = await getPickupScheduling();
  const payments = await getPaymentSettings();
  const switches = await getSwitches();
  const rules = await getRulesSettings();

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Review link, rental rules, pickup scheduling, payments, automation switches and the rental agreement. The Google
        review link is included in the message every renter gets after pickup.
      </p>
      <MarketingSettingsForm initialGoogleUrl={settings.googleReviewUrl} initialFacebookUrl={settings.facebookAdUrl} />
      <RulesSettingsForm initial={rules} />
      <PickupSchedulingForm initial={pickup} />
      <PaymentSettingsForm initial={payments} />
      <SwitchSettingsForm initial={switches} />
      <div className="card" style={{ maxWidth: 720, marginTop: 28 }}>
        <h2 className="card-title card-title--tight">Rental agreement</h2>
        <p className="muted-text" style={{ fontSize: 13, marginBottom: 12 }}>The text renters sign, its versions, and approval.</p>
        <Link href="/staff/settings/agreement" className="button-secondary" style={{ display: "inline-flex" }}>Open agreement text</Link>
      </div>
    </div>
  );
}
