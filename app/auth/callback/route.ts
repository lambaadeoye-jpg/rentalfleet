import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase's magic link redirects here with a `code` query param. Exchanging
// it for a session is what actually logs the applicant in -- without this
// route, clicking the email link would land on a page with no session at all.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/apply";

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
