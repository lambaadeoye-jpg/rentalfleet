import { NextResponse } from "next/server";
import { isAutomationAuthorized } from "@/lib/automation-auth";
import { createClient } from "@supabase/supabase-js";
import { processBilling } from "@/lib/billing";

// Safe to call often: the database only hands out charges that are actually due, and never more than one per rental per 20 hours.
export async function POST(request: Request) {
  if (!isAutomationAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await processBilling(db);
  return NextResponse.json({ success: true, ...result });
}

