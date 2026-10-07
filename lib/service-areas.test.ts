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
