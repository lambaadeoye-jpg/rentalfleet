import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { failureTarget, safeNext } from "@/lib/safe-next";

// Supabase’s magic link redirects here with a `code` query param. Exchanging
// it for a session is what actually logs the applicant in -- without this
// route, clicking the email link would land on a page with no session at all.

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Most often the link was opened in a different browser than the one that asked for it, or it expired.
      return NextResponse.redirect(`${origin}${failureTarget(next)}?link=expired`);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
