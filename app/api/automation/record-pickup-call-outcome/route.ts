import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Internal-only endpoint, called by the n8n "Pickup Reminder - Call
// Outcome" workflow after the Pickup Reminder Vapi assistant finishes a
// call -- never by a browser. Same shared-secret pattern as every other
// automation route.
//
// Like the application-side route, deliberately does NOT touch
// rental.status: a phone call never starts, cancels or changes a rental.
// It records the call, and -- only for a genuine "confirmed" -- stamps
// pickup_confirmed_at, but only while the rental is still 'scheduled'
// (a stale outcome arriving after pickup must not rewrite history).
// Outcomes that mean "a person has to act" force needs_human_followup on,
// regardless of what the model reported.

const OUTCOMES = new Set([
  "confirmed",
  "needs_reschedule",
  "cannot_make_it",
  "needs_help_from_staff",
  "not_applicable", // rental no longer waiting for pickup when the call connected
  "no_answer",
  "wrong_number",
  "voicemail_left",
]);

const ALWAYS_FOLLOW_UP = new Set(["needs_reschedule", "cannot_make_it", "needs_help_from_staff"]);

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
    rentalId?: string;
    outcome?: string;
    summary?: string;
    committedTime?: string;
    needsHumanFollowup?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.rentalId || !body.outcome) {
    return NextResponse.json({ error: "rentalId and outcome are required" }, { status: 400 });
  }
  if (!OUTCOMES.has(body.outcome)) {
    return NextResponse.json({ error: "Unknown outcome" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { error } = await supabase
    .from("rental")
    .update({
      last_call_outcome: body.outcome,
      last_call_at: new Date().toISOString(),
      last_call_summary: body.summary ?? null,
      last_call_committed_time: body.committedTime ?? null,
      needs_human_followup: ALWAYS_FOLLOW_UP.has(body.outcome) || body.needsHumanFollowup === true,
    })
    .eq("id", body.rentalId);

  if (error) {
    console.error("[automation] record-pickup-call-outcome failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  if (body.outcome === "confirmed") {
    const { error: confirmError } = await supabase
      .from("rental")
      .update({ pickup_confirmed_at: new Date().toISOString() })
      .eq("id", body.rentalId)
      .eq("status", "scheduled");
    if (confirmError) console.error("[automation] pickup_confirmed_at update failed:", confirmError);
  }

  return NextResponse.json({ success: true });
}
