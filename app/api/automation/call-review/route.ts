import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeCall } from "@/lib/call-review/normalize";
import { reportedOutcome, runChecks, transcriptText } from "@/lib/call-review/checks";
import { buildTagRequest, callAnthropic, parseTags, FAST_MODEL_DEFAULT, DEEP_MODEL_DEFAULT, type CallTags } from "@/lib/call-review/llm";
import { buildMetrics, buildReportRequest, fallbackReport, parseReport, renderReport, type ReviewRow } from "@/lib/call-review/report";

// Internal endpoint behind the weekly call-review workflow in n8n (never called by a browser).
// Same shared-secret pattern as every other automation route.
//   ingest        n8n sends a batch of raw Vapi calls; they are redacted, checked by rule, and stored.
//   tag           tags a few untagged calls with the AI (short batches so each request stays fast).
//   report_input  returns the request n8n forwards to the AI for the weekly synthesis (long call, so n8n makes it).
//   report_finish validates the AI's reply, stores the report, returns the email.
// Nothing here changes any assistant: the report only suggests.

type Db = SupabaseClient;
const RETENTION_DAYS = 180;
const MAX_INGEST = 25;
const TAG_BATCH = 4;

const NO_CONVERSATION: CallTags = { intent: "no conversation", quality: "ok", sentiment: "neutral", unanswered: [], objections: [], rule_concerns: [], missed_handoff: false, notes: "" };
const TAG_FAILED: CallTags = { ...NO_CONVERSATION, intent: "unavailable", notes: "AI tagging failed for this call." };

async function getTenantId(db: Db): Promise<string | null> {
  const { data } = await db.from("tenant").select("id").eq("status", "active").limit(1).maybeSingle();
  return data?.id ?? null;
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

async function loadRows(db: Db, tenantId: string, start: string, end: string): Promise<{ rows: ReviewRow[]; appStarted: Set<string> }> {
  const { data, error } = await db
    .from("call_review")
    .select("vapi_call_id, assistant_key, started_at, duration_s, ended_reason, customer_id, metrics, checks, tags")
    .eq("tenant_id", tenantId)
    .gte("started_at", start)
    .lt("started_at", end)
    .order("started_at", { ascending: true })
    .order("vapi_call_id", { ascending: true })
    .limit(500);
  if (error) throw new Error(`load failed: ${error.message}`);
  const rows = (data ?? []) as ReviewRow[];

  // Lead calls followed by an application started within 48 hours.
  const appStarted = new Set<string>();
  const leadRows = rows.filter((r) => r.assistant_key === "new_lead" && r.customer_id && r.started_at);
  if (leadRows.length) {
    const { data: apps } = await db
      .from("application")
      .select("customer_id, created_at")
      .eq("tenant_id", tenantId)
      .in("customer_id", [...new Set(leadRows.map((r) => r.customer_id as string))]);
    for (const r of leadRows) {
      const t0 = Date.parse(r.started_at as string);
      if ((apps ?? []).some((a) => a.customer_id === r.customer_id && Date.parse(a.created_at) >= t0 && Date.parse(a.created_at) <= t0 + 48 * 3600 * 1000)) {
        appStarted.add(r.vapi_call_id);
      }
    }
  }
  return { rows, appStarted };
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-automation-secret");
  if (!secret || secret !== process.env.AUTOMATION_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  let body: { action?: string; calls?: unknown; periodStart?: unknown; periodEnd?: unknown; modelText?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const db = createClient(supabaseUrl, serviceRoleKey);
  const tenantId = await getTenantId(db);
  if (!tenantId) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  // ---- ingest ---------------------------------------------------------------------------------------------
  if (body.action === "ingest") {
    const raw = Array.isArray(body.calls) ? (body.calls as Record<string, unknown>[]) : [];
    if (raw.length > MAX_INGEST) return NextResponse.json({ error: `Send at most ${MAX_INGEST} calls per request` }, { status: 400 });

    const out: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const r of raw) {
      const call = r && typeof r === "object" ? normalizeCall(r) : null;
      if (!call) {
        skipped++;
        continue;
      }
      let leadId: string | null = null;
      let customerId: string | null = null;
      if (call.phone) {
        const { data: m } = await db.rpc("match_caller_by_phone", { p_tenant_id: tenantId, p_phone: call.phone });
        const top = ((m ?? []) as { kind: string; id: string; customer_id: string | null }[])[0];
        if (top) {
          leadId = top.kind === "lead" ? top.id : null;
          customerId = top.kind === "customer" ? top.id : top.customer_id;
        }
      }
      out.push({
        tenant_id: tenantId,
        vapi_call_id: call.id,
        assistant_key: call.assistantKey,
        started_at: call.startedAt,
        ended_at: call.endedAt,
        duration_s: call.durationS,
        ended_reason: call.endedReason,
        transcript: transcriptText(call),
        lead_id: leadId,
        customer_id: customerId,
        metrics: {
          outcome: reportedOutcome(call),
          userTurns: call.turns.filter((t) => t.role === "user").length,
          assistantTurns: call.turns.filter((t) => t.role === "assistant").length,
          toolFailures: call.toolCalls.filter((c) => c.failed).length,
        },
        checks: runChecks(call),
      });
    }
    if (out.length) {
      const { error } = await db.from("call_review").upsert(out, { onConflict: "tenant_id,vapi_call_id", ignoreDuplicates: true });
      if (error) {
        console.error("[call-review] ingest failed:", error);
        return NextResponse.json({ error: "Store failed" }, { status: 500 });
      }
    }
    // Retention: drop old reviews.
    await db.from("call_review").delete().eq("tenant_id", tenantId).lt("created_at", new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString());
    return NextResponse.json({ stored: out.length, skipped });
  }

  // ---- tag ------------------------------------------------------------------------------------------------
  if (body.action === "tag") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const { count: before } = await db.from("call_review").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("tags", null);
    if (!apiKey) return NextResponse.json({ llm: false, tagged: 0, remaining: before ?? 0 });

    const { data: batch } = await db
      .from("call_review")
      .select("id, assistant_key, transcript, metrics")
      .eq("tenant_id", tenantId)
      .is("tags", null)
      .order("created_at", { ascending: true })
      .limit(TAG_BATCH);
    const model = process.env.CALL_REVIEW_MODEL_FAST || FAST_MODEL_DEFAULT;
    let tagged = 0;
    await Promise.all(
      (batch ?? []).map(async (row) => {
        let tags: CallTags;
        const userTurns = Number((row.metrics as { userTurns?: number } | null)?.userTurns ?? 0);
        if (userTurns < 2) {
          tags = NO_CONVERSATION;
        } else {
          try {
            const text = await callAnthropic(buildTagRequest(String(row.transcript), String(row.assistant_key), model), apiKey, 12000);
            tags = parseTags(text) ?? TAG_FAILED;
          } catch (e) {
            console.error("[call-review] tag failed:", e instanceof Error ? e.message : e);
            tags = TAG_FAILED;
          }
        }
        const { error } = await db.from("call_review").update({ tags, tagged_at: new Date().toISOString() }).eq("id", row.id);
        if (!error) tagged++;
      }),
    );
    const { count: after } = await db.from("call_review").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("tags", null);
    return NextResponse.json({ llm: true, tagged, remaining: after ?? 0 });
  }

  // ---- report_input / report_finish -----------------------------------------------------------------------
  if (body.action === "report_input" || body.action === "report_finish") {
    const start = isoOrNull(body.periodStart);
    const end = isoOrNull(body.periodEnd);
    if (!start || !end || Date.parse(end) <= Date.parse(start)) {
      return NextResponse.json({ error: "periodStart and periodEnd (ISO dates) are required" }, { status: 400 });
    }
    let loaded: { rows: ReviewRow[]; appStarted: Set<string> };
    try {
      loaded = await loadRows(db, tenantId, start, end);
    } catch (e) {
      console.error("[call-review]", e);
      return NextResponse.json({ error: "Load failed" }, { status: 500 });
    }
    const metrics = buildMetrics(loaded.rows, loaded.appStarted);
    const model = process.env.CALL_REVIEW_MODEL_DEEP || DEEP_MODEL_DEFAULT;
    const { body: aiBody, labels } = buildReportRequest(loaded.rows, metrics, model);

    if (body.action === "report_input") {
      // With no calls there is nothing for the AI to say; n8n skips the AI step.
      return NextResponse.json({ callCount: loaded.rows.length, anthropicRequest: loaded.rows.length ? aiBody : null });
    }

    const withFindings = new Set(loaded.rows.filter((r) => (r.checks ?? []).length > 0).map((r) => r.vapi_call_id));
    const modelText = typeof body.modelText === "string" ? body.modelText : "";
    const report = (modelText ? parseReport(modelText, labels, withFindings) : null) ?? fallbackReport(metrics);
    const rendered = renderReport(start, end, metrics, report);

    const { error } = await db.from("call_review_report").upsert({ tenant_id: tenantId, period_start: start, period_end: end, metrics, report }, { onConflict: "tenant_id,period_start" });
    if (error) console.error("[call-review] report store failed:", error);
    return NextResponse.json({ ...rendered, llm: report.llm, stored: !error });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
