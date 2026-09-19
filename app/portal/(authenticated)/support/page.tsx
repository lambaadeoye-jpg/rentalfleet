import { createClient } from "@/lib/supabase/server";
import SupportTicketForm from "./support-ticket-form";

export const dynamic = "force-dynamic";

export default async function PortalSupportPage() {
  const supabase = await createClient();

  const { data: tickets } = await supabase
    .from("support_ticket")
    .select("id, subject, status, created_at")
    .order("created_at", { ascending: false });

  return (
    <div style={{ padding: "24px 20px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Support</h1>
      <SupportTicketForm initialTickets={tickets ?? []} />
      <a
        href="/portal/profile"
        style={{ display: "block", textAlign: "center", marginTop: 24, color: "var(--teal)", fontSize: 13, fontWeight: 600 }}
      >
        Edit Profile
      </a>
    </div>
  );
}
