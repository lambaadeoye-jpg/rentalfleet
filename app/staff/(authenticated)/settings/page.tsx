import { getMarketingSettings } from "./actions";
import MarketingSettingsForm from "./marketing-settings-form";

export const dynamic = "force-dynamic";

export default async function MarketingSettingsPage() {
  const settings = await getMarketingSettings();

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Marketing Settings</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        These feed the pickup review-request text/email directly -- no need to edit anything in
        n8n when you start a new Facebook ad campaign.
      </p>
      <MarketingSettingsForm initialGoogleUrl={settings.googleReviewUrl} initialFacebookUrl={settings.facebookAdUrl} />
    </div>
  );
}
