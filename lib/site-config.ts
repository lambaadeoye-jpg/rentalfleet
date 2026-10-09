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

// Renter-facing inbox: Reply-To on renter emails, privacy requests, HELP text. Mail still sends from noreply.
export const SUPPORT_EMAIL = "support@rentzivo.com";

// Adopted from Kali's Luxury & Exotics (a direct Nashville rideshare-rental
// competitor) during the competitive review -- a deliberate decision, not a
// placeholder. Revisit if your own insurance underwriting requires
// something different.
export const MINIMUM_AGE = 25;
