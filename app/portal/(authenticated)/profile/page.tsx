import { createClient } from "@/lib/supabase/server";
import ProfileForm from "./profile-form";

export const dynamic = "force-dynamic";

export default async function PortalProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: customer } = await supabase
    .from("customer")
    .select("first_name, last_name, email, phone")
    .eq("auth_user_id", user!.id)
    .single();

  return (
    <div style={{ padding: "24px 20px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Profile</h1>
      <ProfileForm
        initialFirstName={customer?.first_name ?? ""}
        initialLastName={customer?.last_name ?? ""}
        initialPhone={customer?.phone ?? ""}
        email={customer?.email ?? ""}
      />
    </div>
  );
}
