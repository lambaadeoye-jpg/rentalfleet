import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseRange } from "@/lib/analytics";
import { toCsv } from "@/lib/csv";
import { isAdmin, loadBusiness } from "../data";

export const dynamic = "force-dynamic";

const ASSISTANT_LABEL: Record<string, string> = { new_lead: "New lead", nudge: "Application nudge", front_desk: "Front desk", pickup: "Pickup reminder" };

export async function GET(request: Request) {
  const supabase = await createClient();
  if (!(await isAdmin(supabase))) return new NextResponse("Not allowed", { status: 403 });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const range = parseRange({ days: url.searchParams.get("days") ?? undefined, from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined });
  const d = await loadBusiness(supabase, range);

  let rows: Record<string, unknown>[];
  if (kind === "cash") {
    rows = d.cash.weeks.map((w) => ({ week_starting: w.start, rent_collected: w.rent, rent_refunded: w.refunds, net: w.net }));
  } else if (kind === "funnel") {
    rows = d.funnel.map((f) => ({ source: f.label, leads: f.leads, applied: f.applied, approved: f.approved, picked_up: f.pickedUp }));
  } else if (kind === "calls") {
    rows = d.calls.byAssistant.map((a) => ({ assistant: ASSISTANT_LABEL[a.assistant] ?? a.assistant, calls: a.calls, moved_forward: a.positive, need_a_person: a.needsHuman }));
  } else {
    return new NextResponse("Unknown export", { status: 400 });
  }

  const headers = rows.length > 0 ? Object.keys(rows[0]) : kind === "cash" ? ["week_starting", "rent_collected", "rent_refunded", "net"] : kind === "funnel" ? ["source", "leads", "applied", "approved", "picked_up"] : ["assistant", "calls", "moved_forward", "need_a_person"];
  return new NextResponse(toCsv(rows, headers), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="zivo-${kind}-${range.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
