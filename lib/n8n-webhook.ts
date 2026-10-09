import { after } from "next/server";
// Fire-and-forget webhook calls to n8n, triggered by real app events (new
// lead, application decision). Deliberately never throws and never blocks
// the caller -- a notification failing must NEVER break the actual
// user-facing action (submitting a lead, deciding an application). If n8n
// is down, slow, or misconfigured, the lead still gets saved and the
// decision still gets recorded; the notification just silently doesn't
// fire, logged server-side for later investigation rather than surfaced
// to the end user.
//
// Webhook paths are fixed, documented constants (not guessed at runtime)
// so the n8n Webhook trigger nodes can be configured to match exactly --
// see the n8n workflow JSON files for the corresponding trigger config.

const N8N_BASE_URL = process.env.N8N_WEBHOOK_BASE_URL; // e.g. https://lamba001.app.n8n.cloud
// Every n8n webhook rejects calls without this shared secret (header x-webhook-secret). Read per call so tests and env changes apply.
function webhookSecret(): string | undefined {
  return process.env.N8N_WEBHOOK_SECRET || undefined;
}

export const N8N_WEBHOOK_PATHS = {
  newLead: "fleet-rental-new-lead",
  applicationDecision: "fleet-rental-application-decision",
  pickupReviewRequest: "fleet-rental-pickup-review-request",
  documentReady: "fleet-rental-document-ready",
  // Deliberately separate from `newLead` even though both fire off the
  // same event -- keeps "alert staff" and "trigger the AI call" as
  // independently iterable workflows, since SOPs for the calling side
  // specifically are still expected to change.
  newLeadCallTrigger: "fleet-rental-new-lead-call-trigger",
  inboxSendReply: "fleet-rental-inbox-send-reply",
  inboxNewMessageAlert: "fleet-rental-inbox-new-message-alert",
  // Sends one outreach email (welcome/nudge/help). Fired by the outreach dispatcher.
  outreachEmail: "fleet-rental-outreach-email",
  // Application lifecycle events (started, submitted, each document upload). The approve/decline event is
  // applicationDecision above. Receivers in n8n are optional: with none listening these are harmless no-ops.
  applicationStarted: "fleet-rental-application-started",
  applicationSubmitted: "fleet-rental-application-submitted",
  applicationDocumentUploaded: "fleet-rental-application-document-uploaded",
  // A tracker raised a new problem (unplugged, low battery, check engine). Receiver in n8n is optional.
  telematicsAlert: "fleet-rental-telematics-alert",
  // Emails a renter their agreement-signing link. Fired from Contracts when staff choose "Email link".
  agreementEmail: "fleet-rental-agreement-email",
} as const;

/** True when the app knows where n8n lives and has the shared secret, so a webhook can actually be delivered. */
export function n8nConfigured(): boolean {
  return Boolean(process.env.N8N_WEBHOOK_BASE_URL && process.env.N8N_WEBHOOK_SECRET);
}

export function fireN8nWebhook(
  path: (typeof N8N_WEBHOOK_PATHS)[keyof typeof N8N_WEBHOOK_PATHS],
  payload: Record<string, unknown>
): Promise<boolean> {
  const delivery = deliverWebhook(path, payload);
  // Callers often do `void fireN8nWebhook(...)`. On serverless hosting the function can be frozen
  // as soon as the response is sent, which silently drops the call. `after` keeps it alive until
  // the call finishes. Outside a request (tests, scripts) it throws and we just return the promise.
  try {
    after(() => delivery);
  } catch {
    /* not in a request scope */
  }
  return delivery;
}

async function deliverWebhook(
  path: (typeof N8N_WEBHOOK_PATHS)[keyof typeof N8N_WEBHOOK_PATHS],
  payload: Record<string, unknown>
): Promise<boolean> {
  if (!N8N_BASE_URL) {
    // Not configured yet -- expected during initial setup before the n8n
    // workflows exist. Log once per call rather than throw, so the
    // calling action (lead submission, application decision) always
    // succeeds regardless of automation setup state.
    console.warn(`[n8n webhook] N8N_WEBHOOK_BASE_URL not set -- skipping webhook to ${path}`);
    return false;
  }

  const secret = webhookSecret();
  if (!secret) {
    console.warn(`[n8n webhook] N8N_WEBHOOK_SECRET not set -- n8n will reject ${path}`);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${N8N_BASE_URL}/webhook/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { "x-webhook-secret": secret } : {}) },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[n8n webhook] ${path} returned ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    // Network error, timeout, DNS failure -- all swallowed here
    // deliberately. See file header: this must never surface to the user
    // or block the real action.
    console.error(`[n8n webhook] Failed to call ${path}:`, error);
    return false;
  }
}
