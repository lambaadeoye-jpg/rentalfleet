// Every on/off switch staff can flip from Settings. Anything not listed here is rejected,
// so this action can't be used to write arbitrary tenant settings.
export const SWITCHES = [
  { key: "agreement_signing_enabled", label: "Rental agreement signing links", defaultOn: true,
    help: "Turn off to stop every signing link immediately. Nothing is deleted; turn it back on and the same links work again." },
  { key: "upload_links_enabled", label: "Document upload links", defaultOn: true,
    help: "Turn off to stop every document upload link immediately." },
  { key: "weekly_billing_enabled", label: "Charge weekly rent automatically", defaultOn: false,
    help: "Charges each active renter's saved card when a week of rent comes due. Requires Stripe to be connected and the Weekly billing n8n schedule to be active. Turn off to stop charging immediately." },
  { key: "renter_notices_enabled", label: "Text renters about payments, cancellations and refunds", defaultOn: false,
    help: "Texts a renter when a payment is received, weekly rent is charged or fails, a rental is cancelled, or a refund is issued. Needs Twilio set up. While off, nothing is queued, so turning it on later never sends old news." },
  { key: "renter_checkins_enabled", label: "Check-in texts to new renters (day 1 and day 3)", defaultOn: false,
    help: "Texts a renter 1 and 3 days after pickup asking how it's going and pointing them to the portal for help. Needs Twilio set up. While off, nothing is queued." },
  { key: "referral_asks_enabled", label: "Referral ask text (day 8)", defaultOn: false,
    help: "One promotional text a week after pickup with the renter's personal referral link. Only goes to renters who agreed to texts. Have counsel approve the consent wording before turning this on." },
  { key: "auto_refunds_enabled", label: "Auto-approve small refunds", defaultOn: false,
    help: "A renter's own cancellation with a refund under the approval limit, all to their card, is approved automatically. Everything else still needs staff." },
] as const;

export type SwitchKey = (typeof SWITCHES)[number]["key"];
export type SwitchState = { key: string; label: string; help: string; on: boolean };
