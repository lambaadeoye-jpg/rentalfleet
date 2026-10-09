import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import StaffNav from "../staff-nav";
import SignOutButton from "./dashboard/sign-out-button";
import RunnerNav from "../runner-nav";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/staff/login");
  }

  const { data: membership } = await supabase
    .from("membership")
    .select("tenant:tenant_id(name), role:role_id(name)")
    .eq("user_id", user.id)
    .maybeSingle();

  const tenant = (membership?.tenant as any) ?? null;
  const role = (membership?.role as any) ?? null;

  // Real gap closed here: staff previously only learned about things
  // needing attention via SMS/email from n8n -- nothing surfaced in the
  // UI itself. These are the same counts the Dashboard already computes,
  // just now visible from anywhere in the nav, not only after navigating
  // to Dashboard specifically.
  const [
    { count: newLeadsCount },
    { count: pendingApplicationsCount },
    { count: qualifiedReferralsCount },
    { count: flaggedLeadsCount },
    { count: followupCount },
    { count: pendingChargesCount },
    { count: refundAttentionCount },
    { count: overdueCount },
    { data: inboxEvents },
  ] = await Promise.all([
    supabase.from("lead").select("*", { count: "exact", head: true }).eq("stage", "new"),
    supabase.from("application").select("*", { count: "exact", head: true }).eq("status", "submitted"),
    supabase.from("referral").select("*", { count: "exact", head: true }).eq("status", "qualified"),
    supabase.from("lead").select("*", { count: "exact", head: true }).eq("red_flag_matched", true),
    // Pickups badge: rentals the voice assistant flagged for a human.
    supabase.from("rental").select("*", { count: "exact", head: true }).eq("needs_human_followup", true),
    supabase.from("charge").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
    // Refunds waiting for a decision, failed, or needing a manual payback.
    supabase.from("refund").select("*", { count: "exact", head: true }).in("status", ["pending_approval", "failed", "manual_pending"]),
    // Weekly rent past its due date on a rental that is out on the road.
    // Inner join so only schedules belonging to active rentals count.
    supabase
      .from("payment_schedule")
      .select("id, rental!inner(status)", { count: "exact", head: true })
      .eq("status", "active")
      .eq("cadence", "weekly")
      .eq("rental.status", "active")
      .lt("next_due_at", new Date().toISOString()),
    // Same event set and grouping as the Inbox page itself, so the badge
    // always matches what staff see when they open it.
    supabase
      .from("communication_event")
      .select("customer_id, lead_id, direction, payload, handled_at")
      .in("event_type", ["message", "callback_request"])
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  // Unanswered = conversations whose most recent event is inbound.
  const seenConversations = new Set<string>();
  let unansweredCount = 0;
  for (const e of inboxEvents ?? []) {
    const from = (e.payload as { from?: string } | null)?.from ?? "unknown";
    const key = e.customer_id ? `c:${e.customer_id}` : e.lead_id ? `l:${e.lead_id}` : `u:${from}`;
    if (seenConversations.has(key)) continue;
    seenConversations.add(key);
    if (e.direction === "inbound" && !e.handled_at) unansweredCount++;
  }

  // Second batch: counts that need a little joining in code. Volumes are
  // tiny at this stage, so plain id lists beat custom SQL views.
  const [
    { data: approvedApps },
    { data: activeBookings },
    { data: scheduledRentals },
    { data: renterPolicies },
    { count: recoveryAwaitingCount },
    { count: recoveryExpensesPendingCount },
    { count: openIncidentsCount },
    { count: pendingInvitesCount },
  ] = await Promise.all([
    supabase.from("application").select("customer_id").in("status", ["approved", "conditionally_approved"]),
    supabase.from("booking").select("customer_id").neq("status", "cancelled"),
    supabase.from("rental").select("customer_id").eq("status", "scheduled"),
    supabase
      .from("insurance_policy")
      .select("customer_id, verification_status")
      .eq("policy_type", "renter"),
    supabase.from("recovery_case").select("*", { count: "exact", head: true }).in("status", ["delinquent", "review"]),
    supabase.from("recovery_expense").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
    supabase.from("incident").select("*", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("staff_invite").select("*", { count: "exact", head: true }).is("accepted_at", null),
  ]);

  // Applications: approved, but no booking yet = waiting for staff to schedule.
  const bookedCustomers = new Set((activeBookings ?? []).map((b) => b.customer_id));
  const awaitingSchedulingCount = new Set(
    (approvedApps ?? []).map((a) => a.customer_id).filter((id) => id && !bookedCustomers.has(id))
  ).size;

  // Insurance: customers whose policy needs review, plus customers with a
  // scheduled pickup and no verified policy (pickup is blocked until one is).
  const needsReviewStatuses = ["pending", "document_received", "expiring_soon", "review_required"];
  const verifiedStatuses = ["verified_active", "expiring_soon"];
  const verifiedCustomers = new Set(
    (renterPolicies ?? []).filter((p) => verifiedStatuses.includes(p.verification_status)).map((p) => p.customer_id)
  );
  const insuranceAttention = new Set<string>();
  for (const p of renterPolicies ?? []) {
    if (p.customer_id && needsReviewStatuses.includes(p.verification_status)) insuranceAttention.add(p.customer_id);
  }
  for (const r of scheduledRentals ?? []) {
    if (r.customer_id && !verifiedCustomers.has(r.customer_id)) insuranceAttention.add(r.customer_id);
  }

  const badgeCounts: Record<string, number> = {
    "/staff/leads": newLeadsCount ?? 0,
    "/staff/applications": (pendingApplicationsCount ?? 0) + awaitingSchedulingCount,
    "/staff/insurance": insuranceAttention.size,
    "/staff/recovery": (recoveryAwaitingCount ?? 0) + (recoveryExpensesPendingCount ?? 0),
    "/staff/fleet": openIncidentsCount ?? 0,
    "/staff/team": pendingInvitesCount ?? 0,
    "/staff/inbox": unansweredCount,
    // Needs-attention only (follow-ups + overdue rent), not every scheduled
    // pickup -- a badge that is always lit stops meaning anything.
    "/staff/pickups": (followupCount ?? 0) + (overdueCount ?? 0),
    "/staff/charges": pendingChargesCount ?? 0,
    "/staff/refunds": refundAttentionCount ?? 0,
    "/staff/referrals": qualifiedReferralsCount ?? 0,
    "/staff/red-flags": flaggedLeadsCount ?? 0,
  };

  // Field staff get a genuinely different, mobile-first layout -- not the
  // desktop-oriented sidebar. They’re standing next to a car on their
  // phone, not sitting at a desk managing leads and applications; a
  // sidebar built for back-office work is the wrong shape for that job,
  // even though nothing about it was actually broken for them.
  if (role?.name === "field_staff") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--cloud)" }}>
        <header
          style={{
            background: "var(--midnight)",
            color: "white",
            padding: "16px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "sticky",
            top: 0,
            zIndex: 40,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 15 }}>{tenant?.name ?? "Fleet Rental"}</span>
          <SignOutButton />
        </header>
        <main className="app-shell" style={{ paddingBottom: 88 }}>{children}</main>
        <RunnerNav />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <StaffNav tenantName={tenant?.name ?? "Staff portal"} userEmail={user.email ?? ""} roleName={role?.name} badgeCounts={badgeCounts} />
      <main className="app-shell" style={{ flex: 1, background: "var(--cloud)", minHeight: "100vh" }}>{children}</main>
    </div>
  );
}
