import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PRESET_DAYS, applicationAging, changePct, formatHours, inboxResponse, isoDay, medianDecisionHours, parseRange, pickupsByDay, type AppRow, type InboxEvent } from "@/lib/analytics";
import { BarList, ChartCard, ColumnChart, DataTable, Empty, RangeBar, Tile } from "../../charts";

export const dynamic = "force-dynamic";

function weekday(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" });
}

export default async function WorkQueuePage({ searchParams }: { searchParams: Promise<{ days?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/staff/login");
  const { data: mem } = await supabase.from("membership").select("role:role_id(name)").eq("user_id", user.id);
  const roles = (mem ?? []).map((m: any) => m.role?.name as string);
  if (!roles.some((r) => r === "admin" || r === "manager")) redirect("/staff/pickups");

  const now = new Date();
  const range = parseRange(sp, now);
  const weekAhead = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);

  const [apps, events, scheduled, fuLeads, fuApps, fuRentals] = await Promise.all([
    supabase.from("application").select("status, submitted_at, decision_at").not("submitted_at", "is", null).gte("submitted_at", new Date(range.prevFrom.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()).limit(5000),
    supabase.from("communication_event").select("customer_id, lead_id, direction, event_type, created_at, handled_at, payload").eq("event_type", "message").gte("created_at", range.prevFrom.toISOString()).limit(5000),
    supabase.from("rental").select("start_at, assigned_runner_id").eq("status", "scheduled").gte("start_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()).lt("start_at", weekAhead.toISOString()).limit(500),
    supabase.from("lead").select("id", { count: "exact", head: true }).eq("needs_human_followup", true),
    supabase.from("application").select("id", { count: "exact", head: true }).eq("needs_human_followup", true),
    supabase.from("rental").select("id", { count: "exact", head: true }).eq("needs_human_followup", true),
  ]);
  const failed = [apps.error, events.error, scheduled.error].filter(Boolean).length;

  // Waiting applications must be counted whatever their age, so ask for them separately from the decided-in-range set.
  const waiting = await supabase.from("application").select("status, submitted_at, decision_at").in("status", ["submitted", "screening", "review"]).limit(2000);
  const appRows = [...((apps.data ?? []) as AppRow[]), ...((waiting.data ?? []) as AppRow[])];

  const aging = applicationAging((waiting.data ?? []) as AppRow[], now);
  const decision = medianDecisionHours(appRows, range.from, range.to);
  const decisionPrev = medianDecisionHours(appRows, range.prevFrom, range.prevTo);
  const inbox = inboxResponse((events.data ?? []) as InboxEvent[], range.from, range.to, now);
  const inboxPrev = inboxResponse((events.data ?? []) as InboxEvent[], range.prevFrom, range.prevTo, now);
  const days = pickupsByDay((scheduled.data ?? []).map((r: any) => r.start_at as string | null), now, 7);
  const unassigned = (scheduled.data ?? []).filter((r: any) => !r.assigned_runner_id).length;
  const followUps = (fuLeads.count ?? 0) + (fuApps.count ?? 0) + (fuRentals.count ?? 0);
  const toIncl = new Date(range.to.getTime() - 24 * 60 * 60 * 1000);

  const compare = (cur: number | null, prev: number | null, lowerIsBetter = true): string => {
    if (cur === null || prev === null) return "nothing earlier to compare";
    const c = changePct(cur, prev);
    if (c === null) return "nothing earlier to compare";
    return `${c > 0 ? "+" : ""}${c}% vs the previous period${c === 0 ? "" : (c < 0) === lowerIsBetter ? " (better)" : " (slower)"}`;
  };

  return (
    <div className="page viz" style={{ maxWidth: 1040 }}>
      <h1 className="page-title">Work queue</h1>
      <p className="muted-text" style={{ marginBottom: 16 }}>Is the team keeping up? What is waiting, how fast things get answered, and what is coming this week.</p>
      <RangeBar basePath="/staff/work-queue" activeKey={range.key} from={isoDay(range.from)} to={isoDay(toIncl)} presets={PRESET_DAYS} />
      {failed > 0 && <p className="error-text" style={{ marginBottom: 12 }}>Some numbers couldn&rsquo;t be loaded. Refresh to try again.</p>}

      <div className="viz-tiles">
        <Tile label="Applications waiting" value={String(aging.waiting)} sub={aging.oldestHours === null ? "none waiting" : `oldest: ${formatHours(aging.oldestHours)}`} />
        <Tile label="Median time to decide" value={formatHours(decision.median)} sub={`${decision.decided} decided · ${compare(decision.median, decisionPrev.median)}`} />
        <Tile label="Median time to answer a message" value={inbox.medianMinutes === null ? "–" : formatHours(inbox.medianMinutes / 60)} sub={`${inbox.answered} answered · ${compare(inbox.medianMinutes, inboxPrev.medianMinutes)}`} />
        <Tile label="Messages not answered" value={String(inbox.unanswered)} sub={inbox.slowOver4h ? `${inbox.slowOver4h} took over 4 hours` : "none slow"} />
        <Tile label="Open follow-ups" value={String(followUps)} sub="leads, applications and rentals flagged for a person" />
      </div>

      <div className="viz-grid-2">
        <ChartCard title="How long applications have been waiting" subtitle="Submitted and not yet decided. Anything over a day is where renters give up.">
          <BarList
            items={aging.buckets.map((b, i) => ({ label: b.label, value: b.count, display: String(b.count), color: i >= 2 ? "var(--series-2)" : "var(--series-1)" }))}
            emptyText="No applications are waiting. Nice."
          />
        </ChartCard>

        <ChartCard title="Pickups in the next 7 days" subtitle={unassigned > 0 ? `${unassigned} of these still need a runner assigned.` : "Scheduled rentals by day."}>
          <ColumnChart
            labels={days.map((d) => d.day)}
            series={[{ name: "Pickups", color: "var(--series-1)", values: days.map((d) => d.count) }]}
            formatLabel={weekday}
            emptyText="No pickups scheduled for the next 7 days."
            tableTitle="Pickups in the next 7 days"
          />
        </ChartCard>
      </div>

      {followUps > 0 && (
        <ChartCard title="Open follow-ups" subtitle="Flagged by the AI assistants for a person to handle.">
          <BarList
            items={[
              { label: "Leads", value: fuLeads.count ?? 0, href: "/staff/leads" },
              { label: "Applications", value: fuApps.count ?? 0, href: "/staff/applications" },
              { label: "Rentals", value: fuRentals.count ?? 0, href: "/staff/pickups" },
            ]}
            emptyText="No open follow-ups."
          />
        </ChartCard>
      )}
      {followUps === 0 && aging.waiting === 0 && inbox.answered === 0 && decision.decided === 0 && (
        <Empty>Nothing to show yet. This page fills in as applications and messages come in.</Empty>
      )}
      <DataTable
        title="Work queue numbers"
        headers={["Measure", "This period", "Previous period"]}
        rows={[
          ["Median hours to decide an application", decision.median ?? "–", decisionPrev.median ?? "–"],
          ["Applications decided", decision.decided, decisionPrev.decided],
          ["Median minutes to answer a message", inbox.medianMinutes ?? "–", inboxPrev.medianMinutes ?? "–"],
          ["Messages answered", inbox.answered, inboxPrev.answered],
        ]}
      />
    </div>
  );
}
