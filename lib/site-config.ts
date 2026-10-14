// Shared placeholders/decisions used across the public site and the
// Application Workspace. Centralized here rather than duplicated per-file,
// now that a second file (workspace.tsx) needs the phone number too.

// PLACEHOLDER — replace once the real business line is live (ideally the
// same number the Vapi/n8n voice agent answers, so "call us" and the
// automated agent are the same door, not two different numbers).
export const PHONE_DISPLAY = "(615) 555-0100";
export const PHONE_TEL = "+16155550100";
// Call buttons (nav, footer, forms) only appear once a real number replaces the placeholder above. The mobile sticky bar follows the same rule (it used to show Call regardless, which dialled the placeholder).
export const PHONE_IS_LIVE = PHONE_DISPLAY !== "(615) 555-0100";

// Cash App copy on the public site (pricing note, payment FAQ, weekly-billing FAQ) only appears once Cash App Pay
// is actually live in checkout. Flip to true in the same release that enables it; never advertise it before.
export const CASH_APP_IS_LIVE = false;

// Renter-facing inbox: Reply-To on renter emails, privacy requests, HELP text. Mail still sends from noreply.
export const SUPPORT_EMAIL = "support@rentzivo.com";

// Search and sharing copy. Focus is Greater Nashville; pickup is available in Nashville and Murfreesboro.
// Do not mention monthly plans here or anywhere public (Google quotes this text back as the "rental terms").
export const SITE_TITLE = "Gig, Rideshare & Delivery Car Rentals in Greater Nashville | Zivo";
export const SITE_DESCRIPTION =
  "Zivo offers gig, rideshare, and delivery car rentals in Greater Nashville. $222 for your first 3 days, with pickup available in Nashville and Murfreesboro.";

// Adopted from Kali's Luxury & Exotics (a direct Nashville rideshare-rental
// competitor) during the competitive review -- a deliberate decision, not a
// placeholder. Revisit if your own insurance underwriting requires
// something different.
export const MINIMUM_AGE = 25;
