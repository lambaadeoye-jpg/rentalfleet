import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Internal-only endpoint, called by n8n (never by a browser). Authorized
// by a shared secret header, not a user session -- there IS no user
// session for a scheduled n8n workflow to hold. Uses the service role key
// specifically because this write has no corresponding authenticated
// user for RLS to authorize against; the shared-secret check below is
// what actually stands in for that authorization instead.
//
// SUPABASE_SERVICE_ROLE_KEY must never be prefixed NEXT_PUBLIC_ and must
// never be sent to the browser -- this route only runs server-side.

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

  let body: { applicationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.applicationId) {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { error } = await supabase
    .from("application")
    .update({ abandonment_reminder_sent_at: new Date().toISOString() })
    .eq("id", body.applicationId)
    .eq("status", "draft"); // safety check: only mark it if still actually abandoned

  if (error) {
    console.error("[automation] mark-abandonment-reminder-sent failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
