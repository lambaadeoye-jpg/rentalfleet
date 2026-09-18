import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * A plain anon-key client for public, unauthenticated writes (e.g. the lead
 * form's Server Action). Deliberately NOT the cookie-aware @supabase/ssr
 * client from ./server.ts -- there's no user session to track here, this
 * is exactly the anonymous 'anon' Postgres role hitting the RLS policies
 * from migration 0024 (INSERT-only on lead/lead_gig_platform).
 */
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
