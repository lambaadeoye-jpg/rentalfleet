// Texts sent to a renter when money moves or a rental is cancelled. Pure functions only, so the wording and the
// send rules are unit-tested. The database (migration 0081) decides WHICH notices exist; this decides what they say
// and whether to send now.

import { isWithinSendWindow } from "./outreach-rules";
import { toE164 } from "./contact-validation";

export type NoticeKind = "cancelled" | "refund_sent" | "payment_received" | "weekly_rent_charged" | "weekly_charge_failed";

export type NoticeRow = {
  kind: NoticeKind;
  data: Record<string, unknown> | null;
  first_name: string | null;
  phone: string | null;
  suppressed: boolean;
};

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

export function noticeBody(kind: NoticeKind, data: Record<string, unknown> | null, support: string | null): string | null {
  const d = data ?? {};
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
    case "weekly_charge_failed":
      return `Zivo: We couldn't charge your card ${dollars(d.amount_cents)} for this week's rent. Please contact us so we can fix it.${help} ${STOP}`;
    default:
      return null;
  }
}

export function decideNotice(row: NoticeRow, now: Date, smsConfigured: boolean, support: string | null): NoticeDecision {
  if (row.suppressed) return { action: "skip", reason: "suppressed" };
  const to = row.phone ? toE164(row.phone) : null;
  if (!to) return { action: "skip", reason: "no_phone" };
  const body = noticeBody(row.kind, row.data, support);
  if (!body) return { action: "skip", reason: "nothing_to_say" };
  if (!smsConfigured) return { action: "defer", reason: "sms_provider_not_configured" };
  if (!isWithinSendWindow(row.phone as string, now)) return { action: "defer", reason: "quiet_hours" };
  return { action: "send", to, body };
}
