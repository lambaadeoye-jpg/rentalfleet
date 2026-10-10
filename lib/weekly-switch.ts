// Moving a daily rental to the weekly plan (offered from day 3). The database function switch_rental_to_weekly
// (migration 0100) enforces every rule; this file works out the rate, builds the consent wording and turns the
// outcome into plain words. Used by the renter portal and by staff.

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeWeeklyRate, type InsuranceArrangement, type InsurancePricingRules } from "./rental-rate";

const DAY = 24 * 60 * 60 * 1000;

export type SwitchOutcome =
  | "switched" | "not_found" | "not_active" | "already_weekly" | "weekly_not_approved" | "bad_rate"
  | "billing_off" | "card_required" | "not_paid" | "too_early" | "term_ended";

export function switchMessage(outcome: string): string {
  switch (outcome) {
    case "switched": return "You’re on the weekly plan.";
    case "already_weekly": return "This rental is already on the weekly plan.";
    case "card_required": return "The weekly plan needs a card on file. Add your card first, then switch.";
    case "too_early": return "You can switch to weekly from day 3 of your rental.";
    case "term_ended": return "Your first week has ended, so this can’t be switched online. Please contact us.";
    case "not_paid": return "Your first week’s payment hasn’t been recorded yet, so we can’t switch you yet.";
    case "billing_off":
    case "weekly_not_approved":
    case "bad_rate": return "The weekly plan isn’t available right now. Please contact us.";
    case "not_active": return "Your rental has to be active to switch plans.";
    default: return "We couldn’t switch your plan. Please try again or contact us.";
  }
}

/** The renter can switch from day 3 until the end of the prepaid first week. */
export function weeklyOfferWindow(startAt: string | Date | null | undefined, now: Date): { open: boolean; opensAt: Date | null; endsAt: Date | null } {
  if (!startAt) return { open: false, opensAt: null, endsAt: null };
  const s = new Date(startAt);
  if (Number.isNaN(s.getTime())) return { open: false, opensAt: null, endsAt: null };
  const opensAt = new Date(s.getTime() + 3 * DAY);
  const endsAt = new Date(s.getTime() + 7 * DAY);
  return { open: now >= opensAt && now <= endsAt, opensAt, endsAt };
}

const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
const fmtMoney = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "")}`;

/** The exact words the renter agrees to. Stored with the switch. */
export function consentText(rate: number, firstChargeAt: Date, last4: string | null): string {
  const card = last4 ? `my card ending in ${last4}` : "my card on file";
  return `I want to switch to the weekly plan at ${fmtMoney(rate)} per week. My first week is already paid and is not refunded or credited. `
    + `Starting ${fmtDate(firstChargeAt)}, Zivo will charge ${card} ${fmtMoney(rate)} every week until I return the car. `
    + `The 7-day minimum and my deposit stay the same.`;
}

export type WeeklyOffer =
  | { available: false }
  | {
      available: true;
      rate: number;
      firstChargeAt: string;
      cardLast4: string | null;
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
      .select("id, tenant_id, customer_id, status, start_at, insurance_arrangement").eq("id", rentalId).maybeSingle();
    if (!r || !["active", "extended"].includes(r.status as string) || !r.start_at) return { available: false };
    const arrangement = r.insurance_arrangement as InsuranceArrangement | null;
    if (arrangement !== "own" && arrangement !== "via_provider") return { available: false };

    const start = new Date(r.start_at as string);
    if (now.getTime() > start.getTime() + 7 * DAY) return { available: false };
    if (opts.by === "renter" && !weeklyOfferWindow(start, now).open) return { available: false };

    const [{ data: sched }, { data: policy }, { data: setting }, { data: card }, { data: paid }] = await Promise.all([
      admin.from("payment_schedule").select("id").eq("rental_id", rentalId).eq("cadence", "weekly").eq("status", "active").limit(1),
      admin.from("policy_version").select("rules").eq("tenant_id", r.tenant_id).eq("policy_type", "pricing_and_mileage").eq("immutable", false).maybeSingle(),
      admin.from("tenant_setting").select("value").eq("tenant_id", r.tenant_id).eq("key", "weekly_billing_enabled").maybeSingle(),
      admin.from("customer_payment_method").select("last4").eq("tenant_id", r.tenant_id).eq("customer_id", r.customer_id).order("created_at", { ascending: false }).limit(1),
      admin.from("payment").select("id").eq("rental_id", rentalId).eq("kind", "rent").eq("status", "paid").limit(1),
    ]);
    if ((sched ?? []).length > 0 || (paid ?? []).length === 0) return { available: false };
    if (String(setting?.value ?? "").toLowerCase() !== "on") return { available: false };
    const rules = (policy?.rules as { weekly_approved?: boolean; weekly_rate_usd?: number; insurance?: InsurancePricingRules } | null) ?? {};
    if (!rules.weekly_approved) return { available: false };
    const w = computeWeeklyRate(rules.weekly_rate_usd, arrangement, rules.insurance);
    if (!w.ok) return { available: false };

    const firstChargeAt = new Date(start.getTime() + 7 * DAY);
    const last4 = (card?.[0]?.last4 as string | undefined) ?? null;
    return {
      available: true, rate: w.amount, firstChargeAt: firstChargeAt.toISOString(), cardLast4: last4,
      needsCard: (card ?? []).length === 0, consent: consentText(w.amount, firstChargeAt, last4),
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
  });
  if (error) { console.error("[weekly switch] failed:", error.message); return { outcome: "unavailable" }; }
  return { outcome: String(data) as SwitchOutcome, rate: offer.rate };
}
