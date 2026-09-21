// Pure, DB-free pricing calculation -- extracted from scheduleRental()
// specifically so it has real unit test coverage. Everything else in
// this codebase that's this consequential (permission gates, state
// machines, financial write paths) is already verified live against the
// real database throughout this build; this is the one piece of genuine
// calculation logic that lived only inline with no coverage of its own
// at all.

export type DailyPricingRules = {
  first_tier_days: number;
  first_tier_total_usd: number;
  per_day_after_usd: number;
  approved: boolean;
};

// Matches the locked V2.1 formula: a flat total for the first tier of
// days, then a per-day rate after that. The 7-day / $516 example from
// the spec ($220 for days 1-3, then 4 x $74 for days 4-7) is exactly
// calculateDailyRentalPrice(7, { first_tier_days: 3, first_tier_total_usd: 220, per_day_after_usd: 74, approved: true }).
//
// Returns null when rules are missing or not yet approved -- the same
// "don't invent the number" discipline applied throughout this build,
// now enforced in one place instead of duplicated at every call site.
export function calculateDailyRentalPrice(days: number, rules: DailyPricingRules | null | undefined): number | null {
  if (!rules || !rules.approved) return null;

  const extraDays = Math.max(0, days - rules.first_tier_days);
  return rules.first_tier_total_usd + extraDays * rules.per_day_after_usd;
}
