import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { failureTarget, safeNext } from "@/lib/safe-next";
import { originFor, portalForRoles, subdomainsEnabled } from "@/lib/hosts";

// Supabase’s magic link redirects here with a `code` query param. Exchanging
// it for a session is what actually logs the applicant in -- without this
// route, clicking the email link would land on a page with no session at all.

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  let destination = origin;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Most often the link was opened in a different browser than the one that asked for it, or it expired.
      return NextResponse.redirect(`${origin}${failureTarget(next)}?link=expired`);
    }

    // With the portal hosts on, a link may be opened on a host that isn't this person's home (a manager who asked
    // for the link on the admin sign-in page, say). The session is shared across the hosts, so send them straight to
    // the host for their role. The invite page is the exception: a new person has no role yet.
    if (subdomainsEnabled()) {
      if (next === "/portal" || next.startsWith("/portal/")) {
        destination = originFor("my");
      } else if (next.startsWith("/staff") && next !== "/staff/onboard" && !next.startsWith("/staff/onboard/")) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data: memberships } = await supabase.from("membership").select("role:role_id(name)").eq("user_id", user.id);
          const roles = (memberships ?? []).map((m: any) => m.role?.name as string | undefined);
          if (roles.length > 0) destination = originFor(portalForRoles(roles));
        }
      }
    }
  }

  return NextResponse.redirect(`${destination}${next}`);
}
