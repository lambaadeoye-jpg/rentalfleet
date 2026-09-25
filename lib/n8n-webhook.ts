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

export const N8N_WEBHOOK_PATHS = {
  newLead: "fleet-rental-new-lead",
  applicationDecision: "fleet-rental-application-decision",
  pickupReviewRequest: "fleet-rental-pickup-review-request",
  documentReady: "fleet-rental-document-ready",
} as const;

export async function fireN8nWebhook(
  path: (typeof N8N_WEBHOOK_PATHS)[keyof typeof N8N_WEBHOOK_PATHS],
  payload: Record<string, unknown>
): Promise<void> {
  if (!N8N_BASE_URL) {
    // Not configured yet -- expected during initial setup before the n8n
    // workflows exist. Log once per call rather than throw, so the
    // calling action (lead submission, application decision) always
    // succeeds regardless of automation setup state.
    console.warn(`[n8n webhook] N8N_WEBHOOK_BASE_URL not set -- skipping webhook to ${path}`);
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${N8N_BASE_URL}/webhook/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[n8n webhook] ${path} returned ${response.status}`);
    }
  } catch (error) {
    // Network error, timeout, DNS failure -- all swallowed here
    // deliberately. See file header: this must never surface to the user
    // or block the real action.
    console.error(`[n8n webhook] Failed to call ${path}:`, error);
  }
}
