import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Internal-only endpoint, called by the n8n "Call Outcome Report" workflow
// after the New Lead Qualification Vapi assistant finishes a call -- never
// by a browser. Same shared-secret pattern as mark-abandonment-reminder-sent.
//
// The outcome -> stage mapping below is a reasonable default, not a
// locked business rule -- flagged explicitly as something that may need
// adjusting once real SOPs for handling these outcomes are finalized.

// Real bug fixed here: this used to map three outcomes to stage: "lost",
// which is not a valid value -- confirmed directly against the live
// lead_stage_check constraint (new, attempting_contact, contacted,
// qualified, application_invited, application_started,
// application_submitted, screening, approved, booking, converted; no
// "lost" among them). That would have failed at runtime the first time
// any of these three outcomes actually occurred. lost_reason is the
// real mechanism for marking a lead lost -- it's a separate free-text
// field, independent of stage, exactly so a lead can be flagged lost
// without needing a dedicated stage value for it.
const OUTCOME_TO_STAGE: Record<string, string> = {
  application_completed_live: "application_started",
  committed_to_complete: "contacted",
  interested_needs_followup: "contacted",
  not_interested: "contacted", // real contact was made, even though declined
  not_qualified: "contacted", // real contact was made, even though disqualified
  // wrong_number deliberately absent -- we didn't actually reach the
  // real lead, so their stage shouldn't move at all; the real issue is
  // bad contact data, not a change in where they are in the pipeline.
  // no_answer and voicemail_left also deliberately absent for the same
  // reason -- don't move stage on a call that didn't actually reach anyone.
};

const OUTCOME_LOST_REASON: Record<string, string> = {
  not_interested: "Not interested (AI qualification call)",
  not_qualified: "Not qualified (AI qualification call)",
  // wrong_number deliberately absent -- this isn't the lead rejecting
  // us, it's bad contact data. Marking it "lost" would make staff treat
  // this lead as closed-out instead of noticing the phone number needs
  // correcting. needsHumanFollowup (always true for wrong_number) is
  // what surfaces this for staff instead.
};

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
    leadId?: string;
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

  if (!body.leadId || !body.outcome) {
    return NextResponse.json({ error: "leadId and outcome are required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const updatePayload: Record<string, unknown> = {
    last_call_outcome: body.outcome,
    last_call_at: new Date().toISOString(),
    last_call_summary: body.summary ?? null,
    last_call_committed_time: body.committedTime ?? null,
    needs_human_followup: body.needsHumanFollowup ?? false,
  };

  const mappedStage = OUTCOME_TO_STAGE[body.outcome];
  if (mappedStage) {
    updatePayload.stage = mappedStage;
  }
  const lostReason = OUTCOME_LOST_REASON[body.outcome];
  if (lostReason) {
    updatePayload.lost_reason = lostReason;
  }

  const { error } = await supabase.from("lead").update(updatePayload).eq("id", body.leadId);

  if (error) {
    console.error("[automation] record-vapi-call-outcome failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
