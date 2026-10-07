import { describe, it, expect } from "vitest";
import { deriveSource, sanitizeAttribution } from "./attribution";
import { isValidEmail, isValidUsPhone } from "./contact-validation";

describe("deriveSource", () => {
  it("falls back when nothing known", () => expect(deriveSource({}, "homepage")).toBe("homepage"));
  it("meta ads via fbclid", () => expect(deriveSource({ clickId: "fbclid:x" }, "homepage")).toBe("meta_ads"));
  it("google ads via gclid", () => expect(deriveSource({ clickId: "gclid:x" }, "homepage")).toBe("google_ads"));
  it("facebook marketplace", () => expect(deriveSource({ utmSource: "facebook", utmCampaign: "marketplace" }, "h")).toBe("facebook_marketplace"));
  it("gbp", () => expect(deriveSource({ utmSource: "google", utmMedium: "organic", utmCampaign: "gbp" }, "h")).toBe("google_business_profile"));
  it("organic google referrer", () => expect(deriveSource({ referrer: "www.google.com" }, "h")).toBe("google_organic"));
  it("generic utm source", () => expect(deriveSource({ utmSource: "flyer" }, "h")).toBe("flyer"));
});
describe("sanitize", () => {
  it("trims, lowercases, limits", () => {
    const r = sanitizeAttribution({ utmSource: "  FB\n", utmCampaign: "x".repeat(500) });
    expect(r.utmSource).toBe("fb");
    expect(r.utmCampaign!.length).toBe(120);
  });
  it("handles junk", () => expect(sanitizeAttribution(null)).toEqual({}));
});
describe("validation", () => {
  it("emails", () => { expect(isValidEmail("a@b.co")).toBe(true); expect(isValidEmail("a@b")).toBe(false); });
  it("phones", () => { expect(isValidUsPhone("(615) 555-0101")).toBe(true); expect(isValidUsPhone("12345")).toBe(false); });
});

import { sanitizeAttribution as _san } from "./attribution";
describe("cta tag", () => {
  it("keeps clean button codes and drops anything else", () => {
    expect(_san({ cta: "hero" }).cta).toBe("hero");
    expect(_san({ cta: "Hero Button!" }).cta).toBeUndefined();
    expect(_san({ cta: "x".repeat(40) }).cta).toBeUndefined();
  });
});
