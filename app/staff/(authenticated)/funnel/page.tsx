import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90];

const GROUPS = [
  { key: "source", label: "Channel" },
  { key: "campaign", label: "Campaign" },
  { key: "heard_about", label: "“How did you hear about us?”" },
  { key: "button", label: "Website button" },
] as const;

type SourceRow = {
  label: string; leads_count: number; step2_count: number; applied_count: number; approved_count: number;
  signed_count: number; paid_count: number; picked_up_count: number;
};

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "–";
}

export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ days?: string; by?: string }> }) {
  const sp = await searchParams;
  const parsed = Number(sp.days);
  const days = RANGES.includes(parsed) ? parsed : 30;
  const by = GROUPS.some((g) => g.key === sp.by) ? (sp.by as string) : "source";
  const supabase = await createClient();
  const [{ data, error }, { data: srcData, error: srcError }] = await Promise.all([
    supabase.rpc("funnel_summary", { p_days: days }),
    supabase.rpc("funnel_by_source", { p_days: days, p_group: by }),
  ]);
  const srcRows = ((srcData ?? []) as SourceRow[]).map((r) => ({
    label: r.label, leads: Number(r.leads_count), step2: Number(r.step2_count), applied: Number(r.applied_count),
    approved: Number(r.approved_count), signed: Number(r.signed_count), paid: Number(r.paid_count), pickedUp: Number(r.picked_up_count),
  }));
  const rows = ((data ?? []) as { stage_order: number; stage: string; leads_count: number }[]).map((r) => ({
    order: Number(r.stage_order), stage: r.stage, count: Number(r.leads_count),
  }));
  const top = rows[0]?.count ?? 0;

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <h1 className="page-title">Funnel</h1>
      <p className="muted-text" style={{ marginBottom: 16 }}>
        Of the leads created in the period, how many reached each step. Steps are counted per person, so someone who skips
        ahead still counts at every step they reached.
      </p>
      <div className="tab-row">
        {RANGES.map((d) => (
          <a key={d} href={`/staff/funnel?days=${d}&by=${by}`} aria-current={d === days ? "true" : undefined}>
            Last {d} days
          </a>
        ))}
      </div>
      {error ? (
        <p>Couldn&rsquo;t load the funnel. Please try again.</p>
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

      <h2 style={{ fontSize: 16, margin: "36px 0 4px" }}>By source</h2>
      <p className="muted-text" style={{ marginBottom: 12 }}>
        Where leads came from and how far each group got. Small groups swing a lot: judge a source on at least 20 to 30 leads.
      </p>
      <div className="tab-row">
        {GROUPS.map((g) => (
          <a key={g.key} href={`/staff/funnel?days=${days}&by=${g.key}`} aria-current={g.key === by ? "true" : undefined}>
            {g.label}
          </a>
        ))}
      </div>
      {srcError ? (
        <p>Couldn&rsquo;t load the source breakdown. Please try again.</p>
      ) : srcRows.length === 0 ? (
        <p className="muted-text">No leads in this period yet.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                {["", "Leads", "Finished step 2", "Applied", "Approved", "Signed", "Paid", "Picked up", "Lead → picked up"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {srcRows.map((r) => (
                <tr key={r.label}>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>{r.label}</td>
                  <td style={{ padding: "10px 14px" }}>{r.leads}</td>
                  <td style={{ padding: "10px 14px" }}>{r.step2} <span className="muted-text">({pct(r.step2, r.leads)})</span></td>
                  <td style={{ padding: "10px 14px" }}>{r.applied} <span className="muted-text">({pct(r.applied, r.leads)})</span></td>
                  <td style={{ padding: "10px 14px" }}>{r.approved}</td>
                  <td style={{ padding: "10px 14px" }}>{r.signed}</td>
                  <td style={{ padding: "10px 14px" }}>{r.paid}</td>
                  <td style={{ padding: "10px 14px" }}>{r.pickedUp}</td>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>{pct(r.pickedUp, r.leads)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
