// Moving a daily rental to the weekly plan (offered from day 3). The database function switch_rental_to_weekly
// (migration 0100) enforces every rule; this file works out the rate, builds the consent wording and turns the
// outcome into plain words. Used by the renter portal and by staff.

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeWeeklyRate, computeDailyTotal, type InsuranceArrangement, type InsurancePricingRules } from "./rental-rate";

const DAY = 24 * 60 * 60 * 1000;

export type SwitchOutcome =
  | "switched" | "not_found" | "not_active" | "already_weekly" | "weekly_not_approved" | "bad_rate"
  | "billing_off" | "card_required" | "not_paid" | "too_early";

export function switchMessage(outcome: string): string {
  switch (outcome) {
    case "switched": return "You’re on the weekly plan.";
    case "already_weekly": return "This rental is already on the weekly plan.";
    case "card_required": return "The weekly plan needs a card on file. Add your card first, then switch.";
    case "too_early": return "You can switch to weekly from day 3 of your rental.";
    case "not_paid": return "Your first week’s payment hasn’t been recorded yet, so we can’t switch you yet.";
    case "billing_off":
    case "weekly_not_approved":
    case "bad_rate": return "The weekly plan isn’t available right now. Please contact us.";
    case "not_active": return "Your rental has to be active to switch plans.";
    default: return "We couldn’t switch your plan. Please try again or contact us.";
  }
}

export const DEFAULT_OFFER_DAY = 3;
export const MAX_OFFER_DAY = 30;

/** The admin setting for the day the offer opens: a whole number 1 to 30, otherwise the default (matches the database). */
export function parseOfferDay(value: unknown): number {
  const t = String(value ?? "").trim();
  if (!/^[0-9]{1,2}$/.test(t)) return DEFAULT_OFFER_DAY;
  const n = Number(t);
  return n >= 1 && n <= MAX_OFFER_DAY ? n : DEFAULT_OFFER_DAY;
}

/** The renter can switch once the offer day is reached. The offer does not expire. */
export function weeklyOfferWindow(startAt: string | Date | null | undefined, now: Date, offerDay: number = DEFAULT_OFFER_DAY): { open: boolean; opensAt: Date | null } {
  if (!startAt) return { open: false, opensAt: null };
  const s = new Date(startAt);
  if (Number.isNaN(s.getTime())) return { open: false, opensAt: null };
  const opensAt = new Date(s.getTime() + parseOfferDay(offerDay) * DAY);
  return { open: now >= opensAt, opensAt };
}

export type WeeklyCredit = { creditDays: number; remainder: number; paidThrough: Date; firstChargeAt: Date };

/**
 * Days already paid for beyond the first week are credited by moving the first weekly charge later.
 * extra = rent paid minus the first week's price; whole days at the daily rate; the leftover cents are carried.
 * The first charge is on the day the paid days run out, or right away if they already have.
 */
export function weeklyCredit(args: { start: Date; rentPaid: number; firstWeekPrice: number; dailyRate: number | null; now: Date }): WeeklyCredit {
  const termEnd = new Date(args.start.getTime() + 7 * DAY);
  const extra = Math.max(0, Math.round((args.rentPaid - args.firstWeekPrice) * 100) / 100);
  let creditDays = 0;
  let remainder = 0;
  if (extra > 0 && args.dailyRate && args.dailyRate > 0) {
    creditDays = Math.min(60, Math.floor((extra + 0.005) / args.dailyRate));
    remainder = Math.round((extra - creditDays * args.dailyRate) * 100) / 100;
    if (remainder < 0) remainder = 0;
  }
  const paidThrough = new Date(termEnd.getTime() + creditDays * DAY);
  const firstChargeAt = new Date(Math.max(paidThrough.getTime(), args.now.getTime()));
  return { creditDays, remainder, paidThrough, firstChargeAt };
}

const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
const fmtMoney = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "")}`;

/** The exact words the renter agrees to. Stored with the switch. */
export function consentText(rate: number, firstChargeAt: Date, last4: string | null, now: Date = new Date(), creditDays = 0): string {
  const card = last4 ? `my card ending in ${last4}` : "my card on file";
  const credit = creditDays > 0 ? `The ${creditDays} extra day${creditDays === 1 ? "" : "s"} I have already paid for ${creditDays === 1 ? "is" : "are"} credited by moving my first weekly charge later. ` : "";
  return `I want to switch to the weekly plan at ${fmtMoney(rate)} per week. My first week is already paid and is not refunded. ${credit}`
    + `Starting ${firstChargeAt.getTime() <= now.getTime() + 60 * 60 * 1000 ? "today" : fmtDate(firstChargeAt)}, Zivo will charge ${card} ${fmtMoney(rate)} every week until I return the car. `
    + `The 7-day minimum and my deposit stay the same.`;
}

export type WeeklyOffer =
  | { available: false }
  | {
      available: true;
      rate: number;
      firstChargeAt: string;
      cardLast4: string | null;
      /** Extra days the renter already paid for; the first charge is moved out by this many days. */
      creditDays: number;
      offerDay: number;
      /** What the rent already paid covers (stored with the switch). */
      paidThrough: string;
      remainder: number;
      /** True when the renter has no saved card yet: they must add one before switching. */
      needsCard: boolean;
      consent: string;
    };

type Admin = SupabaseClient;

/** Works out whether (and at what price) this rental can move to weekly right now. Never throws. */
export async function loadWeeklyOffer(admin: Admin, rentalId: string, opts: { by: "renter" | "staff"; now?: Date }): Promise<WeeklyOffer> {
  try {
    const now = opts.now ?? new Date();
    const { data: r } = await admin.from("rental")
      .select("id, tenant_id, customer_id, status, start_at, insurance_arrangement, booking:booking_id(quoted_amount)").eq("id", rentalId).maybeSingle();
    if (!r || !["active", "extended"].includes(r.status as string) || !r.start_at) return { available: false };
    const arrangement = r.insurance_arrangement as InsuranceArrangement | null;
    if (arrangement !== "own" && arrangement !== "via_provider") return { available: false };

    const start = new Date(r.start_at as string);

    const [{ data: sched }, { data: policy }, { data: settings }, { data: card }, { data: paid }] = await Promise.all([
      admin.from("payment_schedule").select("id").eq("rental_id", rentalId).eq("cadence", "weekly").eq("status", "active").limit(1),
      admin.from("policy_version").select("rules").eq("tenant_id", r.tenant_id).eq("policy_type", "pricing_and_mileage").eq("immutable", false).maybeSingle(),
      admin.from("tenant_setting").select("key, value").eq("tenant_id", r.tenant_id).in("key", ["weekly_billing_enabled", "weekly_offer_day"]),
      admin.from("customer_payment_method").select("last4").eq("tenant_id", r.tenant_id).eq("customer_id", r.customer_id).order("created_at", { ascending: false }).limit(1),
      admin.from("payment").select("amount").eq("rental_id", rentalId).eq("kind", "rent").eq("status", "paid"),
    ]);
    if ((sched ?? []).length > 0 || (paid ?? []).length === 0) return { available: false };
    const set = Object.fromEntries((settings ?? []).map((x) => [x.key as string, x.value as string]));
    if (String(set.weekly_billing_enabled ?? "").toLowerCase() !== "on") return { available: false };
    const offerDay = parseOfferDay(set.weekly_offer_day);
    if (opts.by === "renter" && !weeklyOfferWindow(start, now, offerDay).open) return { available: false };

    const rules = (policy?.rules as { weekly_approved?: boolean; weekly_rate_usd?: number; insurance?: InsurancePricingRules; daily?: { per_day_after_usd?: number } } | null) ?? {};
    if (!rules.weekly_approved) return { available: false };
    const w = computeWeeklyRate(rules.weekly_rate_usd, arrangement, rules.insurance);
    if (!w.ok) return { available: false };

    // Credit for days already paid beyond the first week.
    const rentPaid = (paid ?? []).reduce((t, p) => t + Number(p.amount), 0);
    const quoted = Number((r.booking as { quoted_amount?: number | null } | null)?.quoted_amount ?? 0);
    const dailyRate = rules.daily?.per_day_after_usd ? computeDailyTotal(rules.daily.per_day_after_usd, 1, arrangement, rules.insurance) : null;
    const credit = weeklyCredit({ start, rentPaid, firstWeekPrice: quoted, dailyRate: dailyRate && dailyRate.ok ? dailyRate.amount : null, now });

    const last4 = (card?.[0]?.last4 as string | undefined) ?? null;
    return {
      available: true, rate: w.amount, firstChargeAt: credit.firstChargeAt.toISOString(), cardLast4: last4,
      creditDays: credit.creditDays, offerDay, paidThrough: credit.paidThrough.toISOString(), remainder: credit.remainder,
      needsCard: (card ?? []).length === 0, consent: consentText(w.amount, credit.firstChargeAt, last4, now, credit.creditDays),
    };
  } catch {
    return { available: false };
  }
}

/** Does the switch. The renter's consent text is rebuilt here from the live numbers, never taken from the browser. */
export async function performWeeklySwitch(
  admin: Admin, rentalId: string, by: "renter" | "staff", actorUserId: string | null,
): Promise<{ outcome: SwitchOutcome | "unavailable"; rate?: number }> {
  const offer = await loadWeeklyOffer(admin, rentalId, { by });
  if (!offer.available) {
    // Ask the database what is wrong so the message is accurate (it re-checks everything itself).
    return { outcome: "unavailable" };
  }
  if (offer.needsCard) return { outcome: "card_required" };
  const { data, error } = await admin.rpc("switch_rental_to_weekly", {
    p_rental: rentalId, p_rate: offer.rate, p_by: by, p_actor: actorUserId, p_consent: offer.consent,
    p_paid_through: offer.paidThrough, p_remainder: offer.remainder, p_credit_days: offer.creditDays,
  });
  if (error) { console.error("[weekly switch] failed:", error.message); return { outcome: "unavailable" }; }
  return { outcome: String(data) as SwitchOutcome, rate: offer.rate };
}
