import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// NOT a server action file (no "use server"): this hands back the service client, so it
// must never be callable from the browser. Authenticates the renter and returns their
// own latest rental. Every portal action that needs elevated access starts here.
export async function owned() {
  const admin = createAdminClient();
  if (!admin) return null;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;
  const { data: customer } = await supabase.from("customer").select("id, tenant_id").eq("auth_user_id", auth.user.id).maybeSingle();
  if (!customer) return null;
  const { data: rental } = await supabase.from("rental").select("id, status, pickup_confirmed_at").eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!rental) return null;
  return {
    admin, customerId: customer.id as string, tenantId: customer.tenant_id as string,
    rentalId: rental.id as string, status: rental.status as string, pickedUp: rental.pickup_confirmed_at != null,
  };
}
