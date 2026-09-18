import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on every route except static assets, so the session cookie stays
     * fresh, but keep it cheap by skipping obviously-static paths.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
