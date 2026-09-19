import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import AnonymousEntry from "./anonymous-entry";
import Workspace from "./workspace";
import { getOrCreateApplication } from "./actions";

export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No session at all -> start one anonymously, silently. This is the fix
  // for the friction flagged in review: previously EVERY first-time
  // visitor had to leave the page, open email, and click a link before
  // they could type a single character. Now that only happens for someone
  // explicitly resuming on a new device (see /apply/resume).
  if (!user) {
    return <AnonymousEntry />;
  }

  const result = await getOrCreateApplication();

  if (!result.success) {
    return (
      <div style={{ maxWidth: 480, margin: "80px auto", textAlign: "center", padding: "0 24px" }}>
        <p className="error-text">{result.error}</p>
      </div>
    );
  }

  // Public client for gig_platform is fine here -- it's non-sensitive
  // reference data, same table the homepage reads.
  const publicClient = createPublicClient();
  const { data: platforms } = await publicClient
    .from("gig_platform")
    .select("id, code, name")
    .order("sort_order");

  return <Workspace data={result.data} platforms={platforms ?? []} />;
}
