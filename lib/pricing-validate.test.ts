import { describe, it, expect } from "vitest";
import { validatePricingMoney } from "./pricing-validate";

describe("validatePricingMoney", () => {
  it("accepts the current launch pricing", () => {
    expect(validatePricingMoney({ daily: { first_tier_days: 3, first_tier_total_usd: 222, per_day_after_usd: 74, approved: true } })).toBeNull();
  });
  it("rejects negative and absurd amounts", () => {
    expect(validatePricingMoney({ weekly_rate_usd: -5 })).toMatch(/weekly rate/);
    expect(validatePricingMoney({ weekly_rate_usd: 1e9 })).toMatch(/weekly rate/);
    expect(validatePricingMoney({ late_fee: { amount_usd: -1 } })).toMatch(/late fee/);
  });
  it("needs figures before approving", () => {
    expect(validatePricingMoney({ daily: { approved: true } })).toMatch(/daily figures/);
    expect(validatePricingMoney({ weekly_approved: true })).toMatch(/weekly rate/);
    expect(validatePricingMoney({ referral: { approved: true } })).toMatch(/referral bonus/);
  });
  it("checks the referral cap", () => {
    expect(validatePricingMoney({ referral: { bonus_usd: 50, cap_type: "per_period", cap_amount_usd: 20, cap_period_days: 30 } })).toMatch(/smaller/);
    expect(validatePricingMoney({ referral: { bonus_usd: 50, cap_type: "per_period", cap_amount_usd: 200, cap_period_days: 30 } })).toBeNull();
  });
  it("rejects NaN", () => expect(validatePricingMoney({ weekly_rate_usd: NaN })).toMatch(/weekly rate/));
});
