import { runnerCanOpen, RUNNER_HOME } from "@/lib/runner-access";
import { hostAction, isAdminOnlyPath, originFor, portalForHost, portalForRoles } from "@/lib/hosts";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Role-specific inactivity timeout, agreed design: generous for
// customers/applicants (the Application Workspace is deliberately
// low-friction -- an aggressive timeout directly fights that design),
// moderate for staff (logging someone out mid-task with unsaved work is
// a real annoyance). Deliberately does NOT do a per-request DB role
// lookup (admin vs field_staff) to pick the threshold -- that would add
// a database round-trip to every single request. Path prefix is used as
// the practical signal instead: /staff/* gets the moderate threshold for
// every staff role alike, /portal/* and /apply/* get the generous one.
// This was an explicit, flagged simplification, not an oversight --
// field_staff was already called out as "least affected either way" when
// this was scoped, so the customer-vs-staff split is the axis that
// actually matters.
const GENEROUS_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days -- customers/applicants
const MODERATE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days -- staff
const LAST_ACTIVITY_COOKIE = "last_activity_at";

/**
 * Refreshes the Supabase auth session on every request and redirects
 * unauthenticated users away from protected routes. This is what makes
 * /staff/dashboard actually protected rather than just "protected in theory."
 */
export async function updateSession(request: NextRequest) {
  // Which portal host is this? (Always "site" until NEXT_PUBLIC_SUBDOMAINS=on, so nothing below changes before then.)
  const portal = portalForHost(request.headers.get("host"));
  const action = hostAction(portal, request.nextUrl.pathname);
  if (action.kind === "redirect") {
    return NextResponse.redirect(`${originFor(action.portal)}${action.path}${request.nextUrl.search}`);
  }
  const onStaffHost = portal === "admin" || portal === "team" || portal === "field";

  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        // Write onto the one response (and the request, so this same request sees the refreshed session).
        // Re-creating the response on every call would drop the earlier cookies when the session is split
        // across several cookies.
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set(name, value);
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set(name, "");
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isStaffArea = request.nextUrl.pathname.startsWith("/staff/") && request.nextUrl.pathname !== "/staff/login";
  const isPortalOrApplyArea =
    ((request.nextUrl.pathname === "/portal" || request.nextUrl.pathname.startsWith("/portal/")) &&
      request.nextUrl.pathname !== "/portal/login") ||
    request.nextUrl.pathname.startsWith("/apply");

  // Inactivity timeout check -- only for signed-in users on a route this
  // applies to. Compares the last recorded activity against the
  // role-appropriate threshold; if exceeded, the session is actually
  // revoked (not just redirected past), so a stale cookie can't be
  // replayed to regain access.
  if (user && (isStaffArea || isPortalOrApplyArea)) {
    const lastActivity = request.cookies.get(LAST_ACTIVITY_COOKIE)?.value;
    const threshold = isStaffArea ? MODERATE_TIMEOUT_MS : GENEROUS_TIMEOUT_MS;

    if (lastActivity && Date.now() - Number(lastActivity) > threshold) {
      await supabase.auth.signOut();
      const loginPath = isStaffArea ? "/staff/login" : "/portal/login";
      const redirectUrl = new URL(loginPath, request.url);
      redirectUrl.searchParams.set("reason", "inactive");
      const redirectResponse = NextResponse.redirect(redirectUrl);
      // signOut()'s cookie-clearing side effects were written onto
      // `response` via the cookie handlers above, not onto this new
      // redirect response -- copy them across explicitly, otherwise the
      // server-side token is correctly revoked but the browser keeps
      // holding the stale cookie values until they expire naturally.
      for (const cookie of response.cookies.getAll()) {
        redirectResponse.cookies.set(cookie);
      }
      return redirectResponse;
    }

    response.cookies.set({
      name: LAST_ACTIVITY_COOKIE,
      value: String(Date.now()),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  // Protects the entire /staff/* area except the login page itself --
  // previously only /staff/dashboard was listed, which meant any new
  // staff route (leads, applications, etc.) would be unprotected by
  // default unless someone remembered to add it here individually.
  if (isStaffArea && !user) {
    const redirectUrl = new URL("/staff/login", request.url);
    redirectUrl.searchParams.set("redirectedFrom", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Who is this? The role is read from the database (one small indexed lookup), never from a cookie the browser
  // could change. Needed for: runners' short page list, the manager's no-go pages, and the host check.
  if (isStaffArea && user && (onStaffHost || !runnerCanOpen(request.nextUrl.pathname) || isAdminOnlyPath(request.nextUrl.pathname))) {
    const { data: memberships, error: roleError } = await supabase.from("membership").select("role:role_id(name)").eq("user_id", user.id);
    const roles = (memberships ?? []).map((m: any) => m.role?.name as string | undefined);
    const redirectWithCookies = (to: string | URL) => {
      const redirectResponse = NextResponse.redirect(to);
      for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
      return redirectResponse;
    };
    const path = request.nextUrl.pathname;
    // A signed-in renter or applicant has no staff membership at all: they have no business in the office area.
    // (The invite page is the one place a not-yet-member must reach: it is what creates the membership.)
    const onInvitePage = path === "/staff/onboard" || path.startsWith("/staff/onboard/");
    if (!roleError && roles.length === 0 && !onInvitePage) return redirectWithCookies(new URL("/staff/login", request.url));
    // Runner-only accounts stay on the runner pages. (Someone with more than one membership is judged by the best one.)
    const runnerOnly = roles.length > 0 && roles.every((r) => r === "field_staff");
    if ((roleError || runnerOnly) && !runnerCanOpen(path)) return redirectWithCookies(new URL(RUNNER_HOME, request.url));
    if (!roleError && roles.length > 0) {
      // Each role signs in on its own host. Cookies are per host, so the right host asks for a fresh sign-in.
      if (onStaffHost) {
        const home = portalForRoles(roles);
        if (home !== portal) return NextResponse.redirect(`${originFor(home)}/staff/login?reason=wrong_portal`);
      }
      // Owner-only pages (team, pricing, settings, export): anyone without the admin role goes to the dashboard.
      if (isAdminOnlyPath(path) && !roles.includes("admin")) return redirectWithCookies(new URL("/staff/dashboard", request.url));
    }
  }

  // Same pattern for the customer portal -- everything under /portal
  // except the login page requires a session.
  const isProtectedPortalRoute =
    (request.nextUrl.pathname === "/portal" || request.nextUrl.pathname.startsWith("/portal/")) &&
    request.nextUrl.pathname !== "/portal/login";

  if (isProtectedPortalRoute && !user) {
    const redirectUrl = new URL("/portal/login", request.url);
    redirectUrl.searchParams.set("redirectedFrom", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (portal !== "site") response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
