import { createClient } from "@/lib/supabase/server";

// Real gap found and closed: audit_event has existed since the original
// schema, with RLS already correctly in place -- but nothing anywhere in
// this build ever wrote to it, despite "material actions are auditable"
// being one of the most repeated locked rules across every spec document.
// Every consequential action was correctly enforced at the database level
// (permission gates, state machines), but none of it produced a human-
// readable trail a staff member could actually go look at.
//
// Scoped honestly, not claimed as complete: wired into the most
// consequential existing actions first (application decisions, pricing
// changes, pickup/dropoff/payment recording) -- not silently retrofitted
// into every single mutation across the whole app in one pass.
//
// Best-effort and silent on failure, same as the n8n webhook pattern --
// a logging failure must never block or fail the real action it's
// describing.
export async function logAuditEvent(params: {
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  source?: string;
}): Promise<void> {
  try {
    // entity_id is a uuid column: anything else would be rejected and the event lost, so keep the event with no id.
    const entityId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.entityId ?? "") ? params.entityId : null;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("audit_event").insert({
      tenant_id: params.tenantId,
      actor_user_id: user?.id ?? null,
      action: params.action,
      entity_type: params.entityType,
      entity_id: entityId,
      before_data: params.beforeData ?? null,
      after_data: params.afterData ?? null,
      source: params.source ?? "staff_portal",
    });
    if (error) console.error("[audit] Insert failed:", params.action, error.message);
  } catch (error) {
    console.error("[audit] Failed to log event:", params.action, error);
  }
}
