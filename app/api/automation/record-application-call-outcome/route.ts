import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Internal-only endpoint, called by the n8n "Application Nudge - Call
// Outcome" workflow after the Application Nudge Vapi assistant finishes a
// call -- never by a browser. Same shared-secret pattern as every other
// automation route.
//
// Deliberately does NOT touch application.status, unlike the lead-side
// outcome route touching lead.stage. A phone call's outcome shouldn't
// mark an application closer to complete than it actually is -- only
// the real submission flow should move status forward. This route only
// ever writes the call-tracking fields themselves.

export async function POST(request: Request) {
  const secret = request.headers.get("x-automation-secret");
  if (!secret || secret !== process.env.AUTOMATION_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) {
    console.error("[automation] Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body: {
    applicationId?: string;
    outcome?: string;
    summary?: string;
    committedTime?: string;
    blocker?: string;
    needsHumanFollowup?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.applicationId || !body.outcome) {
    return NextResponse.json({ error: "applicationId and outcome are required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { error } = await supabase
    .from("application")
    .update({
      last_call_outcome: body.outcome,
      last_call_at: new Date().toISOString(),
      last_call_summary: body.summary ?? null,
      last_call_committed_time: body.committedTime ?? null,
      last_call_blocker: body.blocker ?? null,
      needs_human_followup: body.needsHumanFollowup ?? false,
    })
    .eq("id", body.applicationId);

  if (error) {
    console.error("[automation] record-application-call-outcome failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
