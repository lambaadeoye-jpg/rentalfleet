// Stripe events that need a human: a customer dispute (chargeback) or a refund that failed after Stripe accepted it.
// Cash App refunds are not instant (up to 10 business days) and can fail later, so "refund accepted" is not "money returned".
// Pure parsing so it is unit-tested. The webhook turns these into an audit entry and a staff alert.

export type PaymentAlertKind = "dispute_opened" | "dispute_closed" | "refund_failed";

export type PaymentAlert = {
  eventId: string;
  kind: PaymentAlertKind;
  paymentIntentId: string | null;
  chargeId: string | null;
  amountCents: number | null;
  /** Stripe's dispute reason or refund failure reason, e.g. "fraudulent". */
  reason: string | null;
  /** Dispute status (needs_response, won, lost, ...) or refund status. */
  status: string | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function parsePaymentAlert(raw: unknown): PaymentAlert | null {
  const e = raw as any;
  if (!e || typeof e.id !== "string" || typeof e.type !== "string") return null;
  const o = e.data?.object;
  if (!o || typeof o !== "object") return null;

  if (e.type === "charge.dispute.created" || e.type === "charge.dispute.closed") {
    return {
      eventId: e.id,
      kind: e.type === "charge.dispute.created" ? "dispute_opened" : "dispute_closed",
      paymentIntentId: str(o.payment_intent),
      chargeId: str(o.charge),
      amountCents: Number.isInteger(o.amount) ? o.amount : null,
      reason: str(o.reason),
      status: str(o.status),
    };
  }

  // refund.failed is the dedicated event; charge.refund.updated fires on any change, so only a "failed" status counts.
  if (e.type === "refund.failed" || (e.type === "charge.refund.updated" && o.status === "failed")) {
    return {
      eventId: e.id,
      kind: "refund_failed",
      paymentIntentId: str(o.payment_intent),
      chargeId: str(o.charge),
      amountCents: Number.isInteger(o.amount) ? o.amount : null,
      reason: str(o.failure_reason),
      status: str(o.status),
    };
  }
  return null;
}

/** One line for the audit trail and the staff alert. No personal data. */
export function describePaymentAlert(a: PaymentAlert): string {
  const amount = a.amountCents != null ? ` of $${(a.amountCents / 100).toFixed(2)}` : "";
  const why = a.reason ? ` (${a.reason})` : "";
  if (a.kind === "dispute_opened") return `Payment dispute opened${amount}${why}. Respond in Stripe before the deadline and review this renter.`;
  if (a.kind === "dispute_closed") return `Payment dispute closed${amount}: ${a.status ?? "unknown outcome"}.`;
  return `A refund${amount} failed after Stripe accepted it${why}. The renter has not been paid back; refund them another way.`;
}
