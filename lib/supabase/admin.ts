import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for server-only code that must act on a signed-in
 * renter's behalf where row-level security would (correctly) block them,
 * e.g. the pickup slot functions. Never import this from a client component.
 * Callers MUST authenticate the user first and pass the verified customer id.
 * Returns null when the server isn't configured so callers can fail safely.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
