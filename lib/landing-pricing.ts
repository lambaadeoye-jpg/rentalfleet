// The intro offer shown on the public pages: a flat total for the first few days, then a per-day rate, 7-day minimum.
// Source of truth is the approved pricing policy in the database. If that policy can't be read (missing server key,
// network error, no row yet) the page falls back to the locked business rule so the offer is never silently hidden.
// If the policy IS readable but not approved, nothing is shown (we never advertise an unapproved price).

import { createClient } from "@supabase/supabase-js";

export type DailyPricing = { days: number; total: number; perDay: number };

/** Locked business rule: $222 for the first 3 days, then $75/day, 7-day minimum. Keep in step with the policy. */
export const DEFAULT_INTRO_PRICING: DailyPricing = { days: 3, total: 222, perDay: 75 };
export const MIN_RENTAL_DAYS = 7;

type Rules = { daily?: { approved?: boolean; first_tier_days?: number; first_tier_total_usd?: number; per_day_after_usd?: number } } | null | undefined;

/** null when the policy is not approved or is malformed. */
export function parseDailyPricing(rules: Rules): DailyPricing | null {
  const d = rules?.daily;
  if (!d?.approved || !(d.first_tier_days! > 0) || !(d.first_tier_total_usd! > 0) || !(d.per_day_after_usd! > 0)) return null;
  return { days: d.first_tier_days!, total: d.first_tier_total_usd!, perDay: d.per_day_after_usd! };
}

/** What a minimum-length (7 day) rental costs on the intro rate. */
export function minimumRentalTotal(p: DailyPricing): number {
  return Math.round((p.total + Math.max(0, MIN_RENTAL_DAYS - p.days) * p.perDay) * 100) / 100;
}

/** One line for hero and city pages. */
export function introLine(p: DailyPricing): string {
  return `$${p.total} for your first ${p.days} days, then $${p.perDay}/day. ${MIN_RENTAL_DAYS}-day minimum.`;
}

/** Decide what to show from a database read result. */
export function resolveLandingPricing(read: { ok: boolean; found: boolean; rules?: Rules }): DailyPricing | null {
  if (!read.ok || !read.found) return DEFAULT_INTRO_PRICING;
  return parseDailyPricing(read.rules);
}

/** Server-side read of the approved pricing policy, with the fallback above. */
export async function getDailyPricing(): Promise<DailyPricing | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return resolveLandingPricing({ ok: false, found: false });
  try {
    const db = createClient(url, key);
    const { data, error } = await db.from("policy_version").select("rules").eq("policy_type", "pricing_and_mileage").eq("immutable", false).maybeSingle();
    if (error) return resolveLandingPricing({ ok: false, found: false });
    return resolveLandingPricing({ ok: true, found: !!data, rules: data?.rules as Rules });
  } catch {
    return resolveLandingPricing({ ok: false, found: false });
  }
}
