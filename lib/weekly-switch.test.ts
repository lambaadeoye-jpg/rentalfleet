import { describe, it, expect } from "vitest";
import { consentText, switchMessage, weeklyOfferWindow, weeklyCredit, parseOfferDay } from "./weekly-switch";

const DAY = 24 * 60 * 60 * 1000;
const start = new Date("2026-10-01T15:00:00Z");

describe("weeklyOfferWindow", () => {
  it("opens on day 3 and never closes", () => {
    expect(weeklyOfferWindow(start, new Date(start.getTime() + 2 * DAY)).open).toBe(false);
    expect(weeklyOfferWindow(start, new Date(start.getTime() + 3 * DAY)).open).toBe(true);
    expect(weeklyOfferWindow(start, new Date(start.getTime() + 7 * DAY)).open).toBe(true);
    expect(weeklyOfferWindow(start, new Date(start.getTime() + 30 * DAY)).open).toBe(true);
  });
  it("is closed with no or a bad start date", () => {
    expect(weeklyOfferWindow(null, new Date()).open).toBe(false);
    expect(weeklyOfferWindow("nope", new Date()).open).toBe(false);
  });
});

describe("consentText", () => {
  it("names the rate, the first charge date, the card, and that nothing is credited", () => {
    const t = consentText(450, new Date("2026-10-08T15:00:00Z"), "4242", new Date("2026-10-04T15:00:00Z"));
    expect(t).toContain("$450 per week");
    expect(t).toContain("Oct 8");
    expect(t).toContain("ending in 4242");
    expect(t).toContain("not refunded");
    expect(t).toContain("7-day minimum");
  });
  it("tells the renter about credited days", () => {
    const t = consentText(450, new Date("2026-10-10T15:00:00Z"), "4242", new Date("2026-10-04T15:00:00Z"), 2);
    expect(t).toContain("2 extra days I have already paid for are credited");
    expect(consentText(450, new Date("2026-10-10T15:00:00Z"), "4242", new Date("2026-10-04T15:00:00Z"), 1)).toContain("1 extra day I have already paid for is credited");
    expect(consentText(450, new Date("2026-10-10T15:00:00Z"), "4242", new Date("2026-10-04T15:00:00Z"), 0)).not.toContain("credited");
  });
  it("says today when the first charge is already due", () => {
    const now = new Date("2026-10-12T15:00:00Z");
    expect(consentText(450, now, "4242", now)).toContain("Starting today");
  });
  it("keeps cents when there are some", () => {
    expect(consentText(432.5, new Date("2026-10-08T15:00:00Z"), null, new Date("2026-10-04T15:00:00Z"))).toContain("$432.50 per week");
  });
});

describe("switchMessage", () => {
  it("gives a plain message for every refusal", () => {
    for (const o of ["card_required", "too_early", "not_paid", "billing_off", "weekly_not_approved", "bad_rate", "not_active", "already_weekly", "unavailable", "whatever"]) {
      expect(switchMessage(o).length).toBeGreaterThan(10);
    }
    expect(switchMessage("card_required")).toContain("card");
  });
});

describe("offer day setting", () => {
  it("accepts whole numbers 1 to 30, otherwise falls back to 3", () => {
    expect(parseOfferDay("7")).toBe(7);
    expect(parseOfferDay(" 14 ")).toBe(14);
    expect(parseOfferDay("30")).toBe(30);
    for (const bad of ["0", "31", "99", "-1", "3.5", "abc", "", null, undefined]) expect(parseOfferDay(bad)).toBe(3);
  });
  it("moves the day the offer opens", () => {
    expect(weeklyOfferWindow(start, new Date(start.getTime() + 5 * DAY), 7).open).toBe(false);
    expect(weeklyOfferWindow(start, new Date(start.getTime() + 7 * DAY), 7).open).toBe(true);
    expect(weeklyOfferWindow(start, new Date(start.getTime() + 3 * DAY), 3).open).toBe(true);
  });
});

describe("weeklyCredit", () => {
  const now = (days: number) => new Date(start.getTime() + days * DAY);
  it("has no credit when only the first week was paid; charge on day 7", () => {
    const c = weeklyCredit({ start, rentPaid: 518, firstWeekPrice: 518, dailyRate: 75, now: now(4) });
    expect(c.creditDays).toBe(0);
    expect(c.firstChargeAt.getTime()).toBe(start.getTime() + 7 * DAY);
  });
  it("moves the first charge out by the extra days already paid", () => {
    const c = weeklyCredit({ start, rentPaid: 518 + 150, firstWeekPrice: 518, dailyRate: 75, now: now(5) });
    expect(c.creditDays).toBe(2);
    expect(c.remainder).toBe(0);
    expect(c.firstChargeAt.getTime()).toBe(start.getTime() + 9 * DAY);
  });
  it("carries leftover money that is less than a day", () => {
    const c = weeklyCredit({ start, rentPaid: 518 + 200, firstWeekPrice: 518, dailyRate: 75, now: now(5) });
    expect(c.creditDays).toBe(2);
    expect(c.remainder).toBe(50);
  });
  it("charges right away when the paid days have already been used", () => {
    const n = now(12);
    const c = weeklyCredit({ start, rentPaid: 518 + 150, firstWeekPrice: 518, dailyRate: 75, now: n });
    expect(c.creditDays).toBe(2);
    expect(c.firstChargeAt.getTime()).toBe(n.getTime());
  });
  it("gives no credit without a daily rate or when less than the first week is recorded", () => {
    expect(weeklyCredit({ start, rentPaid: 900, firstWeekPrice: 518, dailyRate: null, now: now(8) }).creditDays).toBe(0);
    expect(weeklyCredit({ start, rentPaid: 400, firstWeekPrice: 518, dailyRate: 75, now: now(8) }).creditDays).toBe(0);
  });
  it("caps the credit at 60 days", () => {
    expect(weeklyCredit({ start, rentPaid: 100000, firstWeekPrice: 518, dailyRate: 75, now: now(8) }).creditDays).toBe(60);
  });
});
