import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every request and redirects
 * unauthenticated users away from protected routes. This is what makes
 * /staff/dashboard actually protected rather than just "protected in theory."
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protects the entire /staff/* area except the login page itself --
  // previously only /staff/dashboard was listed, which meant any new
  // staff route (leads, applications, etc.) would be unprotected by
  // default unless someone remembered to add it here individually.
  const isProtectedRoute =
    request.nextUrl.pathname.startsWith("/staff/") && request.nextUrl.pathname !== "/staff/login";

  if (isProtectedRoute && !user) {
    const redirectUrl = new URL("/staff/login", request.url);
    redirectUrl.searchParams.set("redirectedFrom", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
