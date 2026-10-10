import { describe, it, expect } from "vitest";
import { consentText, switchMessage, weeklyOfferWindow } from "./weekly-switch";

const DAY = 24 * 60 * 60 * 1000;
const start = new Date("2026-10-01T15:00:00Z");

describe("weeklyOfferWindow", () => {
  it("opens on day 3 and closes at the end of the first week", () => {
    expect(weeklyOfferWindow(start, new Date(start.getTime() + 2 * DAY)).open).toBe(false);
    expect(weeklyOfferWindow(start, new Date(start.getTime() + 3 * DAY)).open).toBe(true);
    expect(weeklyOfferWindow(start, new Date(start.getTime() + 7 * DAY)).open).toBe(true);
    expect(weeklyOfferWindow(start, new Date(start.getTime() + 7 * DAY + 1000)).open).toBe(false);
  });
  it("is closed with no or a bad start date", () => {
    expect(weeklyOfferWindow(null, new Date()).open).toBe(false);
    expect(weeklyOfferWindow("nope", new Date()).open).toBe(false);
  });
});

describe("consentText", () => {
  it("names the rate, the first charge date, the card, and that nothing is credited", () => {
    const t = consentText(450, new Date("2026-10-08T15:00:00Z"), "4242");
    expect(t).toContain("$450 per week");
    expect(t).toContain("Oct 8");
    expect(t).toContain("ending in 4242");
    expect(t).toContain("not refunded or credited");
    expect(t).toContain("7-day minimum");
  });
  it("keeps cents when there are some", () => {
    expect(consentText(432.5, new Date("2026-10-08T15:00:00Z"), null)).toContain("$432.50 per week");
  });
});

describe("switchMessage", () => {
  it("gives a plain message for every refusal", () => {
    for (const o of ["card_required", "too_early", "term_ended", "not_paid", "billing_off", "weekly_not_approved", "bad_rate", "not_active", "already_weekly", "unavailable", "whatever"]) {
      expect(switchMessage(o).length).toBeGreaterThan(10);
    }
    expect(switchMessage("card_required")).toContain("card");
  });
});
