// Texts sent to a renter when money moves or a rental is cancelled. Pure functions only, so the wording and the
// send rules are unit-tested. The database (migration 0081) decides WHICH notices exist; this decides what they say
// and whether to send now.

import { isWithinSendWindow } from "./outreach-rules";
import { toE164 } from "./contact-validation";

export type NoticeKind =
  | "cancelled" | "refund_sent" | "payment_received" | "weekly_rent_charged" | "weekly_charge_failed"
  | "checkin_day1" | "checkin_day3" | "referral_ask" | "card_updated" | "rent_due_tomorrow" | "weekly_offer";

export type NoticeRow = {
  kind: NoticeKind;
  data: Record<string, unknown> | null;
  first_name: string | null;
  phone: string | null;
  suppressed: boolean;
  /** Status of the rental the notice is about (check-ins are only sent while it is active). */
  rental_status?: string | null;
  /** The renter's own referral code (referral ask). */
  referral_code?: string | null;
  /** True when the renter has a recorded text/call consent on their lead (needed for the referral ask). */
  has_consent?: boolean;
};

export type NoticeContext = { siteUrl?: string | null; cardUpdateUrl?: string | null };

export type NoticeDecision =
  | { action: "send"; to: string; body: string }
  | { action: "skip"; reason: string }
  | { action: "defer"; reason: string };

export function dollars(cents: unknown): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${(Math.round(n) / 100).toFixed(2)}`;
}

const STOP = "Reply STOP to opt out.";

function base(ctx?: NoticeContext): string {
  return (ctx?.siteUrl || "https://rentzivo.com").replace(/\/$/, "");
}

export function noticeBody(
  kind: NoticeKind,
  data: Record<string, unknown> | null,
  support: string | null,
  ctx?: NoticeContext & { firstName?: string | null; referralCode?: string | null },
): string | null {
  const d = data ?? {};
  const hi = ctx?.firstName ? `Hi ${ctx.firstName}, ` : "";
  const help = support ? ` Questions? ${support}.` : "";
  switch (kind) {
    case "cancelled": {
      const total = Number(d.total_refund_cents ?? 0);
      if (total > 0) return `Zivo: Your rental has been cancelled. We're processing a refund of ${dollars(total)} and will text you when it's issued.${help} ${STOP}`;
      return `Zivo: Your rental has been cancelled. No refund is due.${help} ${STOP}`;
    }
    case "refund_sent": {
      const total = Number(d.total_refund_cents ?? 0);
      const manual = Number(d.manual_cents ?? 0);
      if (!(total > 0)) return null;
      const timing = manual === 0 ? " Banks usually take 5 to 10 business days to show it." : "";
      if (d.reason === "rental_ended") return `Zivo: Your deposit refund of ${dollars(total)} has been issued.${timing}${help} ${STOP}`;
      return `Zivo: Your refund of ${dollars(total)} has been issued.${timing}${help} ${STOP}`;
    }
    case "payment_received": {
      const rent = Number(d.rent_cents ?? 0), dep = Number(d.deposit_cents ?? 0);
      const dep_txt = dep > 0 ? ` (${dollars(rent)} rent + ${dollars(dep)} refundable deposit)` : "";
      return `Zivo: Thanks, we received your payment of ${dollars(rent + dep)}${dep_txt}. ${STOP}`;
    }
    case "weekly_rent_charged":
      return `Zivo: We charged your card ${dollars(d.amount_cents)} for this week's rent. ${STOP}`;
    case "weekly_charge_failed": {
      // With a private update-card link the renter can fix it themselves; without one, point them to us.
      const fix = ctx?.cardUpdateUrl ? `Update your card here: ${ctx.cardUpdateUrl}` : "Please contact us so we can fix it.";
      return `Zivo: We couldn't charge your card ${dollars(d.amount_cents)} for this week's rent. ${fix}${help} ${STOP}`;
    }
    case "card_updated": {
      const last4 = typeof d.last4 === "string" && /^\d{4}$/.test(d.last4) ? d.last4 : null;
      const card = last4 ? `Your new card ending in ${last4}` : "Your new card";
      // No timing promise: we say we will retry and text the result, not when.
      return `Zivo: ${card} is saved. You were not charged. If a payment is past due, we'll try it on this card and text you the result.${help} ${STOP}`;
    }
    case "rent_due_tomorrow": {
      const last4 = typeof d.last4 === "string" && /^\d{4}$/.test(d.last4) ? d.last4 : null;
      const card = last4 ? `your card ending ${last4}` : "your saved card";
      return `Zivo: ${hi}tomorrow we'll charge ${card} ${dollars(d.amount_cents)} for this week's rent. Need to change cards? Update it in your portal: ${base(ctx)}/portal/money ${STOP}`;
    }
    case "weekly_offer": {
      const cents = Number(d.amount_cents ?? 0);
      if (!(cents > 0)) return null;
      const first = typeof d.first_charge_label === "string" && d.first_charge_label ? ` starting ${d.first_charge_label}` : "";
      return `Zivo: ${hi}you can switch to our weekly plan: ${dollars(cents)} a week, charged to your card on file${first}. Your first week is already paid. Switch in your portal: ${base(ctx)}/portal/rental ${STOP}`;
    }
    // Support starts in the portal (V2.1): texts point there rather than inviting replies.
    case "checkin_day1":
      return `Zivo: ${hi}how is the car working out so far? If anything is off, tell us in your portal: ${base(ctx)}/portal ${STOP}`;
    case "checkin_day3":
      return `Zivo: ${hi}quick check-in. Is everything going well with your rental? Questions or issues? Log in to your portal: ${base(ctx)}/portal ${STOP}`;
    case "referral_ask": {
      const code = (ctx?.referralCode ?? "").trim();
      if (!code) return null;
      return `Zivo: ${hi}know another driver who needs a car? Share your personal link: ${base(ctx)}/?ref=${encodeURIComponent(code)} ${STOP}`;
    }
    default:
      return null;
  }
}

const ACTIVE_RENTAL = new Set(["active", "extended"]);

export function decideNotice(
  row: NoticeRow, now: Date, smsConfigured: boolean, support: string | null, ctx?: NoticeContext,
): NoticeDecision {
  if (row.suppressed) return { action: "skip", reason: "suppressed" };
  const to = row.phone ? toE164(row.phone) : null;
  if (!to) return { action: "skip", reason: "no_phone" };
  // Check-ins and the referral ask only make sense while the rental is running.
  if ((row.kind === "checkin_day1" || row.kind === "checkin_day3" || row.kind === "referral_ask" || row.kind === "rent_due_tomorrow" || row.kind === "weekly_offer")
      && !ACTIVE_RENTAL.has(row.rental_status ?? "")) {
    return { action: "skip", reason: "rental_not_active" };
  }
  // The referral ask and the weekly-plan offer are promotional: only with a recorded consent.
  if ((row.kind === "referral_ask" || row.kind === "weekly_offer") && !row.has_consent) return { action: "skip", reason: "no_marketing_consent" };
  const body = noticeBody(row.kind, row.data, support, { ...ctx, firstName: row.first_name, referralCode: row.referral_code });
  if (!body) return { action: "skip", reason: "nothing_to_say" };
  if (!smsConfigured) return { action: "defer", reason: "sms_provider_not_configured" };
  if (!isWithinSendWindow(row.phone as string, now)) return { action: "defer", reason: "quiet_hours" };
  return { action: "send", to, body };
}
