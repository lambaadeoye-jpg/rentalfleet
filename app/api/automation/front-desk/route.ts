import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { callerKey, isLockedOut, LOCKOUT_WINDOW_MINUTES } from "@/lib/caller-lockout";

// Internal-only endpoint behind the Zivo Front Desk Vapi assistant (called
// by the n8n "Vapi Tool - Front Desk" workflow -- never by a browser).
// Same shared-secret pattern as every other automation route.
//
// Per the V2.2 voice architecture, THIS code enforces who can learn what,
// not the model's prompt:
//   - the caller's phone number comes from Vapi's call metadata, never from
//     anything the model typed, and is treated as an identifier only.
//   - anything account-specific requires phone + the email on file (a
//     secondary factor), re-checked on every call (stateless -- no
//     "verified" flag the model could be talked into setting).
//   - application status is deliberately coarse: progress for drafts,
//     "under review" while the team works, and nothing at all about a
//     decision. Decisions are the team's to communicate.
//   - nothing returned ever includes email, phone, documents, screening or
//     red-flag information.

type Db = SupabaseClient;

type Match = { kind: "customer" | "lead"; id: string; first_name: string | null; customer_id: string | null };

type VerifiedCaller = {
  kind: "customer" | "lead";
  leadId: string | null;
  customerId: string | null;
  firstName: string | null;
};

const URGENT_CATEGORIES = new Set([
  "accident_or_injury",
  "vehicle_safety_or_breakdown",
  "police_or_legal",
  "fraud_or_identity",
  "damage_or_insurance_dispute",
  "payment_dispute",
  "recovery_or_towing",
  "complaint_or_abusive",
]);

function asString(v: unknown, max = 500): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

async function getTenantId(db: Db): Promise<string | null> {
  const { data } = await db.from("tenant").select("id").eq("status", "active").limit(1).maybeSingle();
  return data?.id ?? null;
}

async function matchCaller(db: Db, tenantId: string, phone: string): Promise<Match[]> {
  const { data, error } = await db.rpc("match_caller_by_phone", { p_tenant_id: tenantId, p_phone: phone });
  if (error) {
    console.error("[front-desk] match_caller_by_phone failed:", error);
    return [];
  }
  return (data ?? []) as Match[];
}

// Failed verifications for this caller number in the lockout window.
async function recentFailures(db: Db, tenantId: string, key: string | null): Promise<number> {
  if (!key) return 0;
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count, error } = await db
    .from("communication_event")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("event_type", "auth_failed")
    .eq("payload->>caller_key", key)
    .gte("created_at", since);
  if (error) {
    // Fail closed: if the limiter can't be read, don't allow guessing.
    console.error("[front-desk] lockout lookup failed:", error);
    return Number.MAX_SAFE_INTEGER;
  }
  return count ?? 0;
}

const LOCKED_RESPONSE = {
  verified: false,
  locked: true,
  note: "Too many failed attempts. Do not try again on this call. Say you can't verify them right now and offer a callback request or general help only. Never say why.",
};

async function logEvent(
  db: Db,
  tenantId: string,
  eventType: string,
  callId: string,
  payload: Record<string, unknown>,
  ids: { customerId?: string | null; leadId?: string | null } = {},
) {
  const { error } = await db.from("communication_event").insert({
    tenant_id: tenantId,
    customer_id: ids.customerId ?? null,
    lead_id: ids.leadId ?? null,
    channel: "voice",
    direction: "inbound",
    event_type: eventType,
    external_reference: callId || null,
    payload,
  });
  if (error) console.error("[front-desk] failed to log communication_event:", error);
}

// Secondary factor: the caller states the email on file; it must match the
// record that the (server-supplied) phone number matched. Never reveals
// which half failed.
async function verifyCaller(db: Db, tenantId: string, phone: string, claimedEmail: string): Promise<VerifiedCaller | null> {
  if (!claimedEmail) return null;
  const matches = await matchCaller(db, tenantId, phone);
  const wanted = claimedEmail.toLowerCase();
  for (const m of matches) {
    const table = m.kind === "customer" ? "customer" : "lead";
    const { data } = await db.from(table).select("email").eq("id", m.id).maybeSingle();
    const onFile = typeof data?.email === "string" ? data.email.toLowerCase() : "";
    if (onFile && onFile === wanted) {
      return {
        kind: m.kind,
        leadId: m.kind === "lead" ? m.id : null,
        customerId: m.kind === "customer" ? m.id : m.customer_id,
        firstName: m.first_name,
      };
    }
  }
  return null;
}

async function applicationStatus(db: Db, tenantId: string, who: VerifiedCaller) {
  if (!who.customerId) {
    return { found: false, message: "No application on file yet for this caller." };
  }

  const { data: app } = await db
    .from("application")
    .select("id, status, driving_status, has_own_insurance")
    .eq("tenant_id", tenantId)
    .eq("customer_id", who.customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!app) return { found: false, message: "No application on file yet for this caller." };

  if (app.status === "submitted" || app.status === "screening" || app.status === "review") {
    return {
      found: true,
      stage: "under_review",
      message: "Application is submitted and the team is reviewing it. No timeframe can be promised.",
    };
  }

  if (app.status !== "draft") {
    // approved / conditionally_approved / declined / expired: never state a
    // decision on the phone.
    return {
      found: true,
      stage: "team_will_follow_up",
      message: "A team member will follow up directly about this application. Do not say anything about a decision.",
    };
  }

  const cid = who.customerId;
  const [{ data: driver }, { data: docs }, { data: platforms }] = await Promise.all([
    db.from("authorized_driver").select("id").eq("customer_id", cid).eq("is_primary", true).not("license_number_ref", "is", null).limit(1),
    db.from("customer_document").select("document_type").eq("customer_id", cid),
    db.from("platform_eligibility").select("id").eq("application_id", app.id).limit(1),
  ]);
  const has = (t: string) => (docs ?? []).some((d) => d.document_type === t);

  const steps = {
    license_info: (driver ?? []).length > 0,
    license_photo: has("drivers_license"),
    proof_of_residence: has("proof_of_residence"),
    work_info: Boolean(app.driving_status) && (platforms ?? []).length > 0,
    work_document:
      app.driving_status === "already_driving"
        ? has("proof_of_income")
        : app.driving_status === "ready_to_start"
          ? has("platform_approval")
          : false,
    insurance_question: app.has_own_insurance !== null,
  };

  return {
    found: true,
    stage: "in_progress",
    driving_status: app.driving_status ?? null,
    steps,
    message: "Application is started but not submitted. Steps marked false are still to do.",
  };
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-automation-secret");
  if (!secret || secret !== process.env.AUTOMATION_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) {
    console.error("[front-desk] Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body: { action?: string; callerPhone?: string; callId?: string; args?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  const callerPhone = asString(body.callerPhone, 40);
  const callId = asString(body.callId, 100);
  const args = body.args ?? {};

  if (!action) return NextResponse.json({ error: "action is required" }, { status: 400 });

  const db = createClient(supabaseUrl, serviceRoleKey);
  const tenantId = await getTenantId(db);
  if (!tenantId) {
    console.error("[front-desk] No active tenant found");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // identify: what kind of caller is this -- nothing more. Deliberately no
  // name and no account detail before verification.
  if (action === "identify_caller") {
    const matches = callerPhone ? await matchCaller(db, tenantId, callerPhone) : [];
    const top = matches[0];
    const callerType = !top ? "unknown" : top.kind === "customer" ? "existing_customer" : "lead_or_applicant";
    await logEvent(db, tenantId, "call_identified", callId, { callerType }, {
      customerId: top?.kind === "customer" ? top.id : (top?.customer_id ?? null),
      leadId: top?.kind === "lead" ? top.id : null,
    });
    return NextResponse.json({
      callerType,
      note: "Caller ID is only an identifier. Share nothing account-specific until verify_caller succeeds.",
    });
  }

  if (action === "verify_caller") {
    const email = asString(args.email, 200);
    if (!email) {
      // Nothing was actually checked, so this must not count as a failed attempt.
      return NextResponse.json({ verified: false, note: "Ask the caller for the email address on file first." });
    }
    const key = callerKey(callerPhone);
    if (isLockedOut(await recentFailures(db, tenantId, key))) {
      await logEvent(db, tenantId, "auth_locked", callId, { caller_key: key, for: "verify_caller" });
      return NextResponse.json(LOCKED_RESPONSE);
    }
    const who = callerPhone ? await verifyCaller(db, tenantId, callerPhone, email) : null;
    await logEvent(
      db,
      tenantId,
      who ? "auth_succeeded" : "auth_failed",
      callId,
      who ? { method: "phone+email" } : { method: "phone+email", caller_key: key },
      { customerId: who?.customerId ?? null, leadId: who?.leadId ?? null },
    );
    if (!who) {
      return NextResponse.json({
        verified: false,
        note: "Could not verify. Offer general help only, or a callback request. Never say which detail was wrong.",
      });
    }
    return NextResponse.json({ verified: true, firstName: who.firstName });
  }

  if (action === "get_application_status") {
    const email = asString(args.email, 200);
    if (!email) {
      // Nothing was actually checked, so this must not count as a failed attempt.
      return NextResponse.json({ verified: false, note: "Ask the caller for the email address on file first." });
    }
    const key = callerKey(callerPhone);
    if (isLockedOut(await recentFailures(db, tenantId, key))) {
      await logEvent(db, tenantId, "auth_locked", callId, { caller_key: key, for: "application_status" });
      return NextResponse.json(LOCKED_RESPONSE);
    }
    const who = callerPhone ? await verifyCaller(db, tenantId, callerPhone, email) : null;
    if (!who) {
      await logEvent(db, tenantId, "auth_failed", callId, { method: "phone+email", for: "application_status", caller_key: key });
      return NextResponse.json({ verified: false, note: "Verification required first. Do not share any application details." });
    }
    const result = await applicationStatus(db, tenantId, who);
    await logEvent(db, tenantId, "tool_get_application_status", callId, { stage: (result as { stage?: string }).stage ?? "none" }, {
      customerId: who.customerId,
      leadId: who.leadId,
    });
    return NextResponse.json({ verified: true, ...result });
  }

  // request_callback: works for ANYONE, verified or not (spec: unmatched
  // callers get an unmatched-communication record, never silently dropped).
  if (action === "request_callback") {
    const name = asString(args.name, 120);
    const reason = asString(args.reason, 1000);
    const category = asString(args.category, 60) || "general";
    const callbackNumber = asString(args.callbackNumber, 40) || callerPhone;
    if (!reason) return NextResponse.json({ error: "reason is required" }, { status: 400 });

    const urgent = URGENT_CATEGORIES.has(category);
    const matches = callbackNumber ? await matchCaller(db, tenantId, callbackNumber) : [];
    const top = matches[0];
    const customerId = top ? (top.kind === "customer" ? top.id : top.customer_id) : null;

    // Staff-facing record. support_ticket needs a customer, so only a
    // matched customer gets one; everyone else lands in the unmatched
    // communication queue (communication_event) staff already review.
    let ticketCreated = false;
    if (customerId) {
      const { error } = await db.from("support_ticket").insert({
        tenant_id: tenantId,
        customer_id: customerId,
        status: "open",
        priority: urgent ? "high" : "normal",
        subject: `Callback requested (${category}): ${reason}`.slice(0, 300),
      });
      if (error) console.error("[front-desk] support_ticket insert failed:", error);
      else ticketCreated = true;
    }

    await logEvent(
      db,
      tenantId,
      "callback_request",
      callId,
      {
        // from/body make this render as a normal row in /staff/inbox
        // (grouped by the callback number for unmatched callers).
        from: callbackNumber,
        body: `Callback requested (${category}${urgent ? ", URGENT" : ""}): ${reason}${name ? ` - ${name}` : ""}`,
        name,
        reason,
        category,
        urgent,
        callbackNumber,
        matchedKind: top?.kind ?? null,
        ticketCreated,
      },
      { customerId, leadId: top?.kind === "lead" ? top.id : null },
    );

    return NextResponse.json({ success: true, urgent, matched: Boolean(top), ticketCreated });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
