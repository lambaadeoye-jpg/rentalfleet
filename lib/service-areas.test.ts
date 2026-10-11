import { describe, it, expect } from "vitest";
import { SERVICE_AREA_CITIES, getCityBySlug } from "./service-areas";

describe("service areas", () => {
  it("has unique slugs and complete copy for every city", () => {
    const slugs = SERVICE_AREA_CITIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const c of SERVICE_AREA_CITIES) {
      expect(c.slug).toMatch(/^[a-z-]+$/);
      expect(c.heroLine).toContain(c.displayName);
      expect(c.metaDescription).toContain(c.displayName);
      expect(c.localBlurb).toContain(c.displayName);
      expect(c.metaDescription.length).toBeLessThanOrEqual(170);
    }
  });
  it("includes Nashville and Murfreesboro and nothing unconfirmed", () => {
    expect(getCityBySlug("nashville")).toBeDefined();
    expect(getCityBySlug("murfreesboro")).toBeDefined();
    expect(getCityBySlug("atlantis")).toBeUndefined();
  });
});

import { SITE_TITLE, SITE_DESCRIPTION } from "./site-config";

describe("search copy", () => {
  it("focuses on Greater Nashville with pickup in Nashville and Murfreesboro, fits a snippet, and never mentions monthly plans", () => {
    expect(SITE_DESCRIPTION).toContain("Greater Nashville");
    expect(SITE_DESCRIPTION).toContain("pickup available in Nashville and Murfreesboro");
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
    expect(SITE_TITLE.length).toBeLessThanOrEqual(70);
    for (const c of SERVICE_AREA_CITIES) {
      expect(`${SITE_TITLE} ${SITE_DESCRIPTION} ${c.metaDescription} ${c.localBlurb}`.toLowerCase()).not.toContain("monthly");
      expect(c.metaDescription).toContain("Greater Nashville");
    }
  });
});
