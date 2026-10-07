import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";

// Records an email opt-out. Used by the confirm button on /unsubscribe and by mail apps'
// one-click unsubscribe (a POST to the same link). The existing outreach rules already skip
// any address on the suppression list, so nothing else needs to change.
export async function POST(request: Request) {
  const url = new URL(request.url);
  let token = url.searchParams.get("t") ?? "";
  const isForm = (request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  if (!token) {
    try {
      const form = await request.formData();
      token = String(form.get("t") ?? "");
    } catch {
      /* no body */
    }
  }
  const email = verifyUnsubscribeToken(token);
  if (!email) return NextResponse.json({ error: "Invalid link" }, { status: 400 });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  const db = createClient(supabaseUrl, serviceRoleKey);

  const { data: tenant } = await db.from("tenant").select("id").eq("status", "active").limit(1).maybeSingle();
  if (!tenant?.id) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const { error } = await db
    .from("contact_suppression")
    .insert({ tenant_id: tenant.id, email, reason: "unsubscribe", source: "email_link" });
  // 23505 = already unsubscribed, which is a success.
  if (error && error.code !== "23505") {
    console.error("[unsubscribe] failed:", error);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
  if (isForm) return NextResponse.redirect(new URL("/unsubscribe?done=1", request.url), 303);
  return NextResponse.json({ ok: true });
}
