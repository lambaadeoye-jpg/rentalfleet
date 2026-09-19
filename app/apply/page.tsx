import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import SignInForm from "./sign-in-form";
import Workspace from "./workspace";
import { getOrCreateApplication } from "./actions";

export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <SignInForm />;
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
