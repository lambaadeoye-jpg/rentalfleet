import { describe, expect, it } from "vitest";
import { DEFAULT_INTRO_PRICING, introLine, minimumRentalTotal, parseDailyPricing, resolveLandingPricing } from "./landing-pricing";

const approved = { daily: { approved: true, first_tier_days: 3, first_tier_total_usd: 222, per_day_after_usd: 75 } };

describe("landing pricing", () => {
  it("the locked default is $222 for 3 days then $75/day, so a 7-day rental is $522", () => {
    expect(DEFAULT_INTRO_PRICING).toEqual({ days: 3, total: 222, perDay: 75 });
    expect(minimumRentalTotal(DEFAULT_INTRO_PRICING)).toBe(522);
    expect(introLine(DEFAULT_INTRO_PRICING)).toBe("$222 for your first 3 days, then $75/day. 7-day minimum.");
  });
  it("uses the approved policy when it can be read", () => {
    expect(resolveLandingPricing({ ok: true, found: true, rules: approved })).toEqual({ days: 3, total: 222, perDay: 75 });
    expect(resolveLandingPricing({ ok: true, found: true, rules: { daily: { ...approved.daily, first_tier_total_usd: 230 } } })?.total).toBe(230);
  });
  it("falls back to the locked offer when the policy cannot be read or is missing, so the price never disappears", () => {
    expect(resolveLandingPricing({ ok: false, found: false })).toEqual(DEFAULT_INTRO_PRICING);
    expect(resolveLandingPricing({ ok: true, found: false })).toEqual(DEFAULT_INTRO_PRICING);
  });
  it("shows nothing when the policy is readable but not approved or malformed", () => {
    expect(resolveLandingPricing({ ok: true, found: true, rules: { daily: { ...approved.daily, approved: false } } })).toBeNull();
    expect(parseDailyPricing({ daily: { approved: true, first_tier_days: 0, first_tier_total_usd: 222, per_day_after_usd: 75 } })).toBeNull();
    expect(parseDailyPricing(null)).toBeNull();
  });
});
