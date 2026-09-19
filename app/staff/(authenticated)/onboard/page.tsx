import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function StaffOnboardPage() {
  const supabase = await createClient();

  // Authorization here is entirely inside accept_staff_invite() itself --
  // it independently re-derives the caller's real email from auth.uid()
  // and only provisions if a genuine pending staff_invite matches it. This
  // page is just the trigger point, not part of the security boundary.
  const { error } = await supabase.rpc("accept_staff_invite");

  if (error) {
    return (
      <div style={{ maxWidth: 420, margin: "80px auto", padding: "0 24px", textAlign: "center" }}>
        <p className="error-text" style={{ marginBottom: 12 }}>{error.message}</p>
        <p className="muted-text" style={{ fontSize: 14 }}>
          If you believe this is a mistake, ask whoever invited you to send a new invite.
        </p>
      </div>
    );
  }

  redirect("/staff/dashboard");
}
