// First-touch attribution: where did this lead come from?
// Captured in the browser on the first page view, sent along with the lead.
// Everything is untrusted input: the server sanitizes and length-limits it.

export type Attribution = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  clickId?: string; // gclid / fbclid / etc.
  landingPath?: string;
  referrer?: string; // referring hostname only
};

const STORAGE_KEY = "zivo_first_touch";
const MAX = 120;

function clean(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX);
  return t || undefined;
}

export function sanitizeAttribution(a: Attribution | undefined | null): Attribution {
  if (!a || typeof a !== "object") return {};
  return {
    utmSource: clean(a.utmSource)?.toLowerCase(),
    utmMedium: clean(a.utmMedium)?.toLowerCase(),
    utmCampaign: clean(a.utmCampaign),
    utmContent: clean(a.utmContent),
    utmTerm: clean(a.utmTerm),
    clickId: clean(a.clickId),
    landingPath: clean(a.landingPath),
    referrer: clean(a.referrer)?.toLowerCase(),
  };
}

/** Human-readable channel stored in lead.source. */
export function deriveSource(a: Attribution, fallback: string): string {
  const src = a.utmSource ?? "";
  const med = a.utmMedium ?? "";
  const ref = a.referrer ?? "";
  if (a.clickId?.startsWith("fbclid:") || /facebook|fb|meta|instagram|ig/.test(src)) {
    if (/marketplace/.test(src + med + (a.utmCampaign ?? "").toLowerCase())) return "facebook_marketplace";
    return /cpc|paid|ppc|ad/.test(med) || a.clickId ? "meta_ads" : "facebook";
  }
  if (a.clickId?.startsWith("gclid:") || /google/.test(src)) {
    if (/gbp|business|maps|organic/.test(med + src + (a.utmCampaign ?? "").toLowerCase()) && !a.clickId) return "google_business_profile";
    return /cpc|paid|ppc|ad/.test(med) || a.clickId ? "google_ads" : "google";
  }
  if (/marketplace/.test(src)) return "facebook_marketplace";
  if (/sms|text/.test(src + med)) return "sms";
  if (/email|newsletter/.test(src + med)) return "email";
  if (src) return src.slice(0, 40);
  if (/google\./.test(ref)) return "google_organic";
  if (/facebook\.|instagram\.|l\.facebook/.test(ref)) return "facebook";
  if (ref) return "referral_site";
  return fallback;
}

/** Browser only. Stores the first touch; later visits don't overwrite it. */
export function captureFirstTouch(): void {
  try {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(STORAGE_KEY)) return;
    const p = new URLSearchParams(window.location.search);
    const gclid = p.get("gclid");
    const fbclid = p.get("fbclid");
    let refHost = "";
    try {
      refHost = document.referrer ? new URL(document.referrer).hostname : "";
    } catch {
      refHost = "";
    }
    if (refHost === window.location.hostname) refHost = "";
    const a: Attribution = {
      utmSource: p.get("utm_source") ?? undefined,
      utmMedium: p.get("utm_medium") ?? undefined,
      utmCampaign: p.get("utm_campaign") ?? undefined,
      utmContent: p.get("utm_content") ?? undefined,
      utmTerm: p.get("utm_term") ?? undefined,
      clickId: gclid ? `gclid:${gclid}` : fbclid ? `fbclid:${fbclid}` : undefined,
      landingPath: window.location.pathname,
      referrer: refHost || undefined,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeAttribution(a)));
  } catch {
    // Storage blocked: attribution is simply unavailable. Never break the page.
  }
}

export function readFirstTouch(): Attribution {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeAttribution(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}
