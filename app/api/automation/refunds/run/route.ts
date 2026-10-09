import { NextResponse } from "next/server";
import { isAutomationAuthorized } from "@/lib/automation-auth";
import { createClient } from "@supabase/supabase-js";
import { processRefunds } from "@/lib/refunds";

// Called every few minutes by an n8n Schedule trigger (never by a browser) to send
// approved refunds to Stripe. Approvals also send immediately; this is the safety net
// that picks up anything that was approved while Stripe was unreachable or after a crash.
export async function POST(request: Request) {
  if (!isAutomationAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await processRefunds(db);
  return NextResponse.json({ success: true, ...result });
}
