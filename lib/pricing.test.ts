import { describe, it, expect } from "vitest";
import { calculateDailyRentalPrice } from "./pricing";

const APPROVED_RULES = {
  first_tier_days: 3,
  first_tier_total_usd: 220,
  per_day_after_usd: 74,
  approved: true,
};

describe("calculateDailyRentalPrice", () => {
  it("matches the exact locked V2.1 example: 7 days = $516", () => {
    // From the spec itself: "First 3 days $220, Days 4-7 4 x $74 = $296,
    // 7-day total $516" -- this is the one number in the whole build
    // that's independently verifiable against a written spec, not just
    // internally consistent.
    expect(calculateDailyRentalPrice(7, APPROVED_RULES)).toBe(516);
  });

  it("charges exactly the tier total at the tier boundary (3 days = $220, no per-day addition)", () => {
    expect(calculateDailyRentalPrice(3, APPROVED_RULES)).toBe(220);
  });

  it("does not go below the tier total for fewer days than the tier (1 day = $220, not prorated down)", () => {
    // The formula is a flat tier total, not a per-day rate for the first
    // tier -- a 1-day rental still costs the full 3-day tier price. This
    // is a real, easy-to-get-wrong edge case: Math.max(0, extraDays)
    // exists specifically to prevent a negative extraDays count from
    // *subtracting* from the tier total.
    expect(calculateDailyRentalPrice(1, APPROVED_RULES)).toBe(220);
  });

  it("scales correctly for a longer rental (14 days)", () => {
    // 220 + (14-3)*74 = 220 + 814 = 1034
    expect(calculateDailyRentalPrice(14, APPROVED_RULES)).toBe(1034);
  });

  it("returns null when rules are not approved", () => {
    expect(calculateDailyRentalPrice(7, { ...APPROVED_RULES, approved: false })).toBeNull();
  });

  it("returns null when rules are missing entirely", () => {
    expect(calculateDailyRentalPrice(7, null)).toBeNull();
    expect(calculateDailyRentalPrice(7, undefined)).toBeNull();
  });

  it("respects a different tier configuration if an admin changes it via /staff/pricing", () => {
    const customRules = { first_tier_days: 5, first_tier_total_usd: 300, per_day_after_usd: 50, approved: true };
    // 300 + (10-5)*50 = 300 + 250 = 550
    expect(calculateDailyRentalPrice(10, customRules)).toBe(550);
  });
});
