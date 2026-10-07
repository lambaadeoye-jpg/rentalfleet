// Ad tracking. Both tools stay off until their IDs are set in Netlify
// (NEXT_PUBLIC_META_PIXEL_ID, NEXT_PUBLIC_GOOGLE_TAG_ID). No personal details are ever sent with an event.

type Win = Window & { fbq?: (...a: unknown[]) => void; gtag?: (...a: unknown[]) => void };

/** Call when someone submits step 1 of the lead form. Safe when no tool is installed. */
export function trackLead(): void {
  try {
    const w = window as Win;
    w.fbq?.("track", "Lead");
    w.gtag?.("event", "generate_lead");
  } catch {
    // Never let tracking break the form.
  }
}
