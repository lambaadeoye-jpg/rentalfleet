// Pure, DB-free rate calculation for insurance arrangement and deposit.
// Backend-only: renters never see this logic; staff communicate the final
// numbers after approval.
//
// Two arrangements, decided per rental:
//   own           the renter has their own insurance  -> percentage discount
//                 off the rental fee (admin-editable, default 22%)
//   via_provider  the renter has none and buys cover themselves from a
//                 provider (Bonzah, RentalCover, ...) -> a fixed weekly
//                 amount (admin-editable) is taken off what they pay us,
//                 because they pay that cost to the provider directly.
//
// Applies to both plans. For the daily plan the weekly deduction is
// converted to a per-day amount (weekly / 7) times the billable days.
// Nothing here invents a number: unapproved or missing rules return an
// error instead of a guess.

export type InsuranceArrangement = "own" | "via_provider";

export type InsurancePricingRules = {
  insured_discount_pct: number | null;
  uninsured_weekly_deduction_usd: number | null;
  approved: boolean;
};

export type DepositRules = {
  amount_usd: number | null;
  approved: boolean;
};

export const DEPOSIT_MIN_USD = 100;
export const DEPOSIT_MAX_USD = 200;

export type RateResult =
  | { ok: true; amount: number; base: number; adjustment: number }
  | { ok: false; error: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

function adjust(base: number, arrangement: InsuranceArrangement, rules: InsurancePricingRules | null | undefined, daysFraction: number): RateResult {
  if (!rules || !rules.approved) {
    return { ok: false, error: "Insurance pricing isn't set up yet. An admin needs to approve it on the Pricing page." };
  }

  let adjustment: number;
  if (arrangement === "own") {
    const pct = rules.insured_discount_pct;
    if (pct === null || pct === undefined || !(pct >= 0 && pct < 100)) {
      return { ok: false, error: "The insured discount isn't set to a valid percentage (0-99) on the Pricing page." };
    }
    adjustment = -round2((base * pct) / 100);
  } else {
    const ded = rules.uninsured_weekly_deduction_usd;
    if (ded === null || ded === undefined || !(ded >= 0)) {
      return { ok: false, error: "The weekly insurance deduction isn't set on the Pricing page." };
    }
    adjustment = -round2(ded * daysFraction);
  }

  const amount = round2(base + adjustment);
  if (!(amount > 0)) {
    return { ok: false, error: "That insurance setting would bring the rent to zero or below. Check the Pricing page." };
  }
  return { ok: true, amount, base, adjustment };
}

// What the renter owes us per week on the weekly plan.
export function computeWeeklyRate(
  weeklyRateUsd: number | null | undefined,
  arrangement: InsuranceArrangement,
  rules: InsurancePricingRules | null | undefined
): RateResult {
  if (weeklyRateUsd === null || weeklyRateUsd === undefined || !(weeklyRateUsd > 0)) {
    return { ok: false, error: "The weekly rate isn't set on the Pricing page." };
  }
  return adjust(weeklyRateUsd, arrangement, rules, 1);
}

// What the renter owes us in total on the daily plan, given the standard
// (pre-insurance) total for the billable days.
export function computeDailyTotal(
  standardTotalUsd: number | null | undefined,
  billableDays: number,
  arrangement: InsuranceArrangement,
  rules: InsurancePricingRules | null | undefined
): RateResult {
  if (standardTotalUsd === null || standardTotalUsd === undefined || !(standardTotalUsd > 0)) {
    return { ok: false, error: "The daily price isn't available. Check the Pricing page." };
  }
  if (!(billableDays > 0)) return { ok: false, error: "Billable days must be positive." };
  return adjust(standardTotalUsd, arrangement, rules, billableDays / 7);
}

// The refundable deposit: one admin-set amount, always inside the allowed
// range, and separate from rent.
export function resolveDeposit(rules: DepositRules | null | undefined):
  | { ok: true; amount: number }
  | { ok: false; error: string } {
  if (!rules || !rules.approved || rules.amount_usd === null || rules.amount_usd === undefined) {
    return { ok: false, error: "The refundable deposit isn't set up yet. An admin needs to set it on the Pricing page." };
  }
  if (!(rules.amount_usd >= DEPOSIT_MIN_USD && rules.amount_usd <= DEPOSIT_MAX_USD)) {
    return { ok: false, error: `The deposit must be between $${DEPOSIT_MIN_USD} and $${DEPOSIT_MAX_USD}. Fix it on the Pricing page.` };
  }
  return { ok: true, amount: round2(rules.amount_usd) };
}

// Card in the renter's own name only; cash is no longer accepted.
export const ACCEPTED_PAYMENT_METHODS = ["card"] as const;
