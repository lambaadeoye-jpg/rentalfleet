import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90];

export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams;
  const parsed = Number(sp.days);
  const days = RANGES.includes(parsed) ? parsed : 30;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("funnel_summary", { p_days: days });
  const rows = ((data ?? []) as { stage_order: number; stage: string; leads_count: number }[]).map((r) => ({
    order: Number(r.stage_order), stage: r.stage, count: Number(r.leads_count),
  }));
  const top = rows[0]?.count ?? 0;

  return (
    <div style={{ padding: "32px 40px", maxWidth: 820 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Funnel</h1>
      <p className="muted-text" style={{ marginBottom: 16 }}>
        Of the leads created in the period, how many reached each step. Steps are counted per person, so someone who skips
        ahead still counts at every step they reached.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {RANGES.map((d) => (
          <a key={d} href={`/staff/funnel?days=${d}`} className="btn"
            style={{ fontWeight: d === days ? 700 : 400, textDecoration: d === days ? "underline" : "none" }}>
            Last {d} days
          </a>
        ))}
      </div>
      {error ? (
        <p>Couldn&apos;t load the funnel. Please try again.</p>
      ) : top === 0 ? (
        <p className="muted-text">No leads in this period yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((r, i) => {
            const pctOfTop = Math.round((r.count / top) * 100);
            const prev = i > 0 ? rows[i - 1].count : null;
            const stepPct = prev && prev > 0 ? Math.round((r.count / prev) * 100) : null;
            return (
              <div key={r.order}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 4 }}>
                  <span>{r.stage}</span>
                  <span>
                    <strong>{r.count}</strong>
                    <span className="muted-text"> · {pctOfTop}% of leads{stepPct !== null ? ` · ${stepPct}% of previous step` : ""}</span>
                  </span>
                </div>
                <div style={{ background: "rgba(128,128,128,0.18)", borderRadius: 6, height: 14 }}>
                  <div style={{ width: `${pctOfTop}%`, height: 14, borderRadius: 6, background: "currentColor", opacity: 0.55 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
