import { createClient } from "@/lib/supabase/server";
import type { Range } from "@/lib/analytics";
import { personRows, personWeekly, recentActions, type AuditRow, type HandledRow } from "@/lib/team-activity";

type Db = Awaited<ReturnType<typeof createClient>>;

/** Admin-only scorecard by person. Names come from the team list; someone removed from the team shows as "Former team member". */
export async function loadPeople(supabase: Db, range: Range, selected: string | null) {
  const [aud, han, mem] = await Promise.all([
    supabase.from("audit_event").select("actor_user_id, action, entity_id, created_at").not("actor_user_id", "is", null).gte("created_at", range.from.toISOString()).lt("created_at", range.to.toISOString()).order("created_at", { ascending: false }).limit(5000),
    supabase.from("communication_event").select("handled_by, created_at, handled_at").not("handled_by", "is", null).gte("handled_at", range.from.toISOString()).lt("handled_at", range.to.toISOString()).limit(5000),
    supabase.from("membership").select("user_id, role:role_id(name), user_profile:user_id(full_name, email)"),
  ]);
  const errors = [aud.error, han.error, mem.error].filter(Boolean).length;
  const audit = (aud.data ?? []) as AuditRow[];
  const handled = (han.data ?? []) as HandledRow[];

  const decisionIds = [...new Set(audit.filter((a) => a.action === "application_decision" && a.entity_id).map((a) => a.entity_id as string))];
  const submitted = new Map<string, string>();
  if (decisionIds.length > 0) {
    const { data } = await supabase.from("application").select("id, submitted_at").in("id", decisionIds.slice(0, 500));
    for (const r of (data ?? []) as { id: string; submitted_at: string | null }[]) if (r.submitted_at) submitted.set(r.id, r.submitted_at);
  }

  const names = new Map<string, { name: string; role: string }>();
  for (const m of (mem.data ?? []) as any[]) {
    names.set(m.user_id, { name: m.user_profile?.full_name || m.user_profile?.email || "Team member", role: m.role?.name ?? "" });
  }

  const rows = personRows(audit, handled, submitted, range.from, range.to).map((r) => ({
    ...r,
    name: names.get(r.userId)?.name ?? "Former team member",
    role: names.get(r.userId)?.role ?? "",
  }));
  const chosen = selected && rows.some((r) => r.userId === selected) ? selected : null;
  return {
    errors,
    rows,
    truncated: audit.length >= 5000 || handled.length >= 5000,
    detail: chosen ? { weekly: personWeekly(chosen, audit, handled, range.from, range.to), recent: recentActions(chosen, audit) } : null,
    chosen,
  };
}
