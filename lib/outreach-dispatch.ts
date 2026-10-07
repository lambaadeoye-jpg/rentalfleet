// Decides and performs one outreach send. All I/O is injected so the
// behavior (what happens when a provider is missing, stale rows, failures)
// is unit-tested. The route handles database bookkeeping from the outcome.

import {
  OUTREACH_PLAN, SMS_TEMPLATES, decideSend, renderTemplate, type LeadState,
} from "./outreach-rules";
import { toE164 } from "./contact-validation";

export type ClaimedRow = {
  id: string;
  tenant_id: string;
  lead_id: string;
  step_key: string;
  channel: "sms" | "call" | "email";
  attempts: number;
  scheduled_for: string;
  first_name: string | null;
  phone: string | null;
  email: string | null;
  has_consent: boolean;
  red_flagged: boolean;
  stage: string | null;
  customer_id: string | null;
  touches_sent: number;
  has_inbound_reply: boolean;
  suppressed: boolean;
};

export type Deps = {
  smsConfigured: boolean;
  sendSms: (toE164: string, body: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
  fireCall: (leadId: string) => Promise<boolean>;
  fireEmail: (payload: Record<string, unknown>) => Promise<boolean>;
  applyLink: string;
  /** Builds the one-click unsubscribe link for an address (null if unsigned). */
  unsubscribeUrl?: (email: string) => string | null;
  now: Date;
};

export type Outcome =
  | { kind: "sent"; providerId?: string; body?: string }
  | { kind: "skipped"; reason: string }
  | { kind: "deferred"; until: Date; reason: string }
  | { kind: "retry"; error: string; final: boolean };

/** Anything later than this past its scheduled time is dropped, not sent
 * late (for example after a provider outage or before Twilio was set up). */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
export const MAX_ATTEMPTS = 3;

export async function processRow(row: ClaimedRow, deps: Deps): Promise<Outcome> {
  const step = OUTREACH_PLAN.find((s) => s.key === row.step_key);
  if (!step) return { kind: "skipped", reason: "unknown_step" };

  if (deps.now.getTime() - new Date(row.scheduled_for).getTime() > STALE_AFTER_MS) {
    return { kind: "skipped", reason: "stale" };
  }

  const lead: LeadState = {
    hasConsent: row.has_consent,
    suppressed: row.suppressed,
    redFlagged: row.red_flagged,
    hasInboundReply: row.has_inbound_reply,
    // Moved past "new" by staff, or linked to a customer record (they
    // started an application): stop the nudges.
    progressed: (row.stage != null && row.stage !== "new") || row.customer_id != null,
    touchesSent: row.touches_sent,
    hasPhone: Boolean(row.phone && toE164(row.phone)),
    hasEmail: Boolean(row.email && row.email.trim()),
  };
  const decision = decideSend(step, lead, row.phone ?? "", deps.now);
  if (decision.action === "skip") return { kind: "skipped", reason: decision.reason };
  if (decision.action === "defer") return { kind: "deferred", until: decision.until, reason: decision.reason };

  const fail = (error: string): Outcome => ({ kind: "retry", error, final: row.attempts >= MAX_ATTEMPTS });

  if (step.channel === "sms") {
    if (!deps.smsConfigured) return { kind: "deferred", until: new Date(deps.now.getTime() + 15 * 60 * 1000), reason: "sms_provider_not_configured" };
    const to = toE164(row.phone ?? "");
    const tpl = SMS_TEMPLATES[step.key];
    if (!to || !tpl) return { kind: "skipped", reason: "no_phone" };
    const body = renderTemplate(tpl, { first: (row.first_name ?? "").trim() || "there", link: deps.applyLink });
    const r = await deps.sendSms(to, body);
    return r.ok ? { kind: "sent", providerId: r.id, body } : fail(r.error ?? "sms_failed");
  }

  if (step.channel === "call") {
    const ok = await deps.fireCall(row.lead_id);
    return ok ? { kind: "sent" } : fail("call_trigger_failed");
  }

  const ok = await deps.fireEmail({
    leadId: row.lead_id,
    stepKey: step.key,
    to: row.email,
    firstName: (row.first_name ?? "").trim(),
    applyLink: deps.applyLink,
    unsubscribeUrl: row.email && deps.unsubscribeUrl ? deps.unsubscribeUrl(row.email) : null,
  });
  return ok ? { kind: "sent" } : fail("email_trigger_failed");
}
