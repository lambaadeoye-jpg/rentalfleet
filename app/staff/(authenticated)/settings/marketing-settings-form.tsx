"use client";

import { useState } from "react";
import { saveMarketingSettings } from "./actions";

export default function MarketingSettingsForm({
  initialGoogleUrl,
  initialFacebookUrl,
}: {
  initialGoogleUrl: string;
  initialFacebookUrl: string;
}) {
  const [googleUrl, setGoogleUrl] = useState(initialGoogleUrl);
  const [facebookUrl, setFacebookUrl] = useState(initialFacebookUrl);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setError(null);
    setSaved(false);
    setLoading(true);
    const result = await saveMarketingSettings(googleUrl, facebookUrl);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't save. Please try again.");
      return;
    }
    setSaved(true);
  }

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Google review link</span>
        <input
          value={googleUrl}
          onChange={(e) => setGoogleUrl(e.target.value)}
          placeholder="https://g.page/r/your-business/review"
        />
      </label>
      <p className="muted-text" style={{ fontSize: 12, marginBottom: 16 }}>
        Rarely changes -- this is your Google Business Profile's review link.
      </p>

      <label className="field">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Current Facebook ad URL</span>
        <input
          value={facebookUrl}
          onChange={(e) => setFacebookUrl(e.target.value)}
          placeholder="https://facebook.com/your-page/posts/..."
        />
      </label>
      <p className="muted-text" style={{ fontSize: 12, marginBottom: 16 }}>
        Update this whenever a new ad campaign starts -- every future pickup review request
        will point to whatever's saved here.
      </p>

      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
      {saved && <p style={{ color: "var(--signal-green, #16a34a)", fontSize: 14, marginBottom: 12 }}>Saved.</p>}

      <button onClick={handleSave} disabled={loading} className="button-primary">
        {loading ? "Saving..." : "Save Settings"}
      </button>
    </div>
  );
}
