// Server-side checks for the parts of the pricing form that decide what renters are charged.
// Pure so it can be tested; returns an error sentence or null.

type Num = number | null | undefined;
const ok = (n: Num): n is number => typeof n === "number" && Number.isFinite(n);

export type PricingCheckInput = {
  daily?: { first_tier_days?: Num; first_tier_total_usd?: Num; per_day_after_usd?: Num; approved?: boolean };
  weekly_rate_usd?: Num;
  weekly_approved?: boolean;
  late_fee?: { grace_days?: Num; amount_usd?: Num; approved?: boolean };
  referral?: { bonus_usd?: Num; approved?: boolean; cap_type?: string; cap_amount_usd?: Num; cap_period_days?: Num };
};

export function validatePricingMoney(r: PricingCheckInput): string | null {
  const d = r.daily;
  if (d) {
    if (d.first_tier_days != null && !(Number.isInteger(d.first_tier_days) && d.first_tier_days >= 1 && d.first_tier_days <= 7)) return "The first daily tier must be a whole number of days from 1 to 7.";
    if (d.first_tier_total_usd != null && !(ok(d.first_tier_total_usd) && d.first_tier_total_usd > 0 && d.first_tier_total_usd <= 5000)) return "The first daily tier price must be more than $0 and at most $5,000.";
    if (d.per_day_after_usd != null && !(ok(d.per_day_after_usd) && d.per_day_after_usd > 0 && d.per_day_after_usd <= 1000)) return "The per-day price after the first tier must be more than $0 and at most $1,000.";
    if (d.approved && !(ok(d.first_tier_days) && ok(d.first_tier_total_usd) && ok(d.per_day_after_usd))) return "Fill in all three daily figures before approving daily pricing.";
  }
  if (r.weekly_rate_usd != null && !(ok(r.weekly_rate_usd) && r.weekly_rate_usd > 0 && r.weekly_rate_usd <= 10000)) return "The weekly rate must be more than $0 and at most $10,000.";
  if (r.weekly_approved && !(ok(r.weekly_rate_usd) && r.weekly_rate_usd > 0)) return "Set the weekly rate before approving weekly pricing.";

  const l = r.late_fee;
  if (l) {
    if (l.grace_days != null && !(Number.isInteger(l.grace_days) && l.grace_days >= 0 && l.grace_days <= 30)) return "Late fee grace days must be a whole number from 0 to 30.";
    if (l.amount_usd != null && !(ok(l.amount_usd) && l.amount_usd >= 0 && l.amount_usd <= 1000)) return "The late fee must be between $0 and $1,000.";
    if (l.approved && !ok(l.amount_usd)) return "Set the late fee amount before approving it.";
  }

  const f = r.referral;
  if (f) {
    if (f.bonus_usd != null && !(ok(f.bonus_usd) && f.bonus_usd >= 0 && f.bonus_usd <= 1000)) return "The referral bonus must be between $0 and $1,000.";
    if (f.approved && !(ok(f.bonus_usd) && f.bonus_usd > 0)) return "Set the referral bonus before approving it.";
    if (f.cap_type === "per_period") {
      if (!(ok(f.cap_amount_usd) && f.cap_amount_usd > 0 && f.cap_amount_usd <= 100000)) return "Set a cap amount above $0 for the referral cap.";
      if (!(ok(f.cap_period_days) && Number.isInteger(f.cap_period_days) && f.cap_period_days >= 1 && f.cap_period_days <= 3650)) return "Set the cap period as a whole number of days.";
      if (ok(f.bonus_usd) && f.cap_amount_usd < f.bonus_usd) return "The referral cap can’t be smaller than one bonus.";
    }
  }
  return null;
}
