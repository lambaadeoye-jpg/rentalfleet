import { niceMax } from "@/lib/analytics";

// Small dependency-free charts, drawn on the server as SVG. Every chart has a table view and plain-text hover
// tooltips (the browser's own), and shows a clear message instead of an empty frame when there is no data yet.

export function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="viz-tile">
      <div className="viz-tile__label">{label}</div>
      <div className="viz-tile__value">{value}</div>
      {sub ? <div className="viz-tile__sub">{sub}</div> : null}
    </div>
  );
}

export function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="viz-card">
      <h2>{title}</h2>
      {subtitle ? <p className="viz-sub">{subtitle}</p> : null}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="viz-empty">{children}</p>;
}

export type Series = { name: string; color: string; values: number[] };

function compact(n: number, money: boolean): string {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? `${Math.round((abs / 1000) * 10) / 10}K` : String(Math.round(abs));
  return `${n < 0 ? "-" : ""}${money ? "$" : ""}${s}`;
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

type ColumnProps = {
  labels: string[]; series: Series[]; money: boolean; valueSuffix: string; top: number;
  formatLabel: (l: string) => string; tableTitle: string;
  W: number; H: number; fs: number; maxLabels: number;
};

// One drawing of the column chart at a given width. Two are rendered (wide for desktop, compact for phones) and CSS
// shows one, so axis text stays readable on a phone instead of shrinking with the whole drawing.
function ColumnPlot({ labels, series, money, valueSuffix, top, formatLabel, tableTitle, W, H, fs, maxLabels }: ColumnProps) {
  const L = W < 500 ? 44 : 48, R = 8, T = 10, B = 28;
  const innerW = W - L - R, innerH = H - T - B;
  const slot = innerW / labels.length;
  const barW = Math.min(24, Math.max(4, (slot - 8) / series.length - 2));
  const groupW = series.length * barW + (series.length - 1) * 2;
  const y = (v: number) => T + innerH - (v / top) * innerH;
  const ticks = [0, top / 2, top];
  const every = Math.ceil(labels.length / maxLabels);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tableTitle}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={fs} fill="#667085">{compact(t, money)}{valueSuffix}</text>
        </g>
      ))}
      {labels.map((l, i) => {
        const x0 = L + i * slot + (slot - groupW) / 2;
        return (
          <g key={l}>
            {series.map((s, k) => {
              const v = s.values[i] ?? 0;
              const h = Math.max(0, innerH - (y(v) - T));
              const x = x0 + k * (barW + 2);
              if (!v) return null;
              const r = Math.min(4, h / 2, barW / 2);
              // Rounded at the top, square on the baseline.
              const d = `M${x},${T + innerH} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + barW - r} Q${x + barW},${y(v)} ${x + barW},${y(v) + r} V${T + innerH} Z`;
              return (
                <path key={s.name} d={d} fill={s.color}>
                  <title>{`${formatLabel(l)}: ${s.name} ${money ? "$" : ""}${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}${valueSuffix}`}</title>
                </path>
              );
            })}
            {i % every === 0 && (
              <text x={L + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize={fs} fill="#667085">{formatLabel(l)}</text>
            )}
          </g>
        );
      })}
      <line x1={L} x2={W - R} y1={T + innerH} y2={T + innerH} stroke="#d0d5dd" strokeWidth={1} />
    </svg>
  );
}

/** Columns grouped by label (for example by week). Bars are capped at 24px with a 2px gap between them. */
export function ColumnChart({ labels, series, money = false, valueSuffix = "", max, emptyText, formatLabel = shortDate, tableTitle }: {
  labels: string[];
  series: Series[];
  money?: boolean;
  valueSuffix?: string;
  max?: number;
  emptyText: string;
  formatLabel?: (l: string) => string;
  tableTitle: string;
}) {
  const all = series.flatMap((s) => s.values);
  if (labels.length === 0 || all.every((v) => !v)) return <Empty>{emptyText}</Empty>;
  const top = max ?? niceMax(Math.max(...all));
  const common = { labels, series, money, valueSuffix, top, formatLabel, tableTitle };

  return (
    <div>
      {series.length > 1 && (
        <div className="viz-legend">
          {series.map((s) => (
            <span key={s.name} style={{ ["--c" as string]: s.color }}>{s.name}</span>
          ))}
        </div>
      )}
      <div className="viz-wide"><ColumnPlot {...common} W={640} H={240} fs={11} maxLabels={8} /></div>
      <div className="viz-narrow"><ColumnPlot {...common} W={360} H={230} fs={12} maxLabels={4} /></div>
      <DataTable title={tableTitle} headers={["Week of", ...series.map((s) => s.name)]} rows={labels.map((l, i) => [formatLabel(l), ...series.map((s) => `${money ? "$" : ""}${(s.values[i] ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}${valueSuffix}`)])} />
    </div>
  );
}

function PercentPlot({ labels, values, color, tableTitle, W, H, fs, maxLabels }: { labels: string[]; values: number[]; color: string; tableTitle: string; W: number; H: number; fs: number; maxLabels: number }) {
  const L = W < 500 ? 40 : 48, R = 16, T = 10, B = 28;
  const innerW = W - L - R, innerH = H - T - B;
  const x = (i: number) => L + (labels.length === 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const y = (v: number) => T + innerH - (Math.min(100, v) / 100) * innerH;
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const every = Math.ceil(labels.length / maxLabels);
  const last = values.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tableTitle}>
      {[0, 50, 100].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={fs} fill="#667085">{t}%</text>
        </g>
      ))}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <circle key={labels[i]} cx={x(i)} cy={y(v)} r={4} fill={color} stroke="white" strokeWidth={2}>
          <title>{`Week of ${shortDate(labels[i])}: ${v}% of car-days rented`}</title>
        </circle>
      ))}
      <text x={x(last)} y={y(values[last]) - 10} textAnchor="end" fontSize={fs + 1} fontWeight={700} fill="#101828">{values[last]}%</text>
      {labels.map((l, i) => (i % every === 0 ? <text key={l} x={x(i)} y={H - 8} textAnchor="middle" fontSize={fs} fill="#667085">{shortDate(l)}</text> : null))}
    </svg>
  );
}

/** One line over weeks, 0 to 100 percent. */
export function PercentLine({ labels, values, color, emptyText, tableTitle }: { labels: string[]; values: number[]; color: string; emptyText: string; tableTitle: string }) {
  if (labels.length === 0 || values.every((v) => !v)) return <Empty>{emptyText}</Empty>;
  return (
    <div>
      <div className="viz-wide"><PercentPlot labels={labels} values={values} color={color} tableTitle={tableTitle} W={640} H={220} fs={11} maxLabels={8} /></div>
      <div className="viz-narrow"><PercentPlot labels={labels} values={values} color={color} tableTitle={tableTitle} W={360} H={210} fs={12} maxLabels={4} /></div>
      <DataTable title={tableTitle} headers={["Week of", "Utilization"]} rows={labels.map((l, i) => [shortDate(l), `${values[i]}%`])} />
    </div>
  );
}

export type BarItem = { label: string; value: number; display?: string; href?: string; color?: string };

/** Horizontal bars with the value at the tip. */
export function BarList({ items, emptyText }: { items: BarItem[]; emptyText: string }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  if (items.length === 0 || max === 0) return <Empty>{emptyText}</Empty>;
  return (
    <div className="viz-barlist">
      {items.map((i) => (
        <div className="viz-barlist__row" key={i.label}>
          <span>{i.href ? <a href={i.href}>{i.label}</a> : i.label}</span>
          <div className="viz-barlist__track" title={`${i.label}: ${i.display ?? i.value}`}>
            <div className="viz-barlist__bar" style={{ width: `${Math.max(1, (i.value / max) * 100)}%`, background: i.color }} />
          </div>
          <strong>{i.display ?? i.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function DataTable({ title, headers, rows }: { title: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <details className="viz-details">
      <summary>View as table</summary>
      <table className="viz-table" aria-label={title}>
        <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

/** Range picker: presets, a custom range and the comparison, all plain links and a GET form. */
export function RangeBar({ basePath, activeKey, from, to, presets, extra }: { basePath: string; activeKey: string; from: string; to: string; presets: readonly number[]; extra?: Record<string, string> }) {
  const qs = (o: Record<string, string>) => `${basePath}?${new URLSearchParams({ ...extra, ...o }).toString()}`;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 16 }}>
      <div className="tab-row" style={{ margin: 0 }}>
        {presets.map((d) => (
          <a key={d} href={qs({ days: String(d) })} aria-current={activeKey === String(d) ? "true" : undefined}>Last {d} days</a>
        ))}
      </div>
      <form method="get" action={basePath} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label style={{ fontSize: 12 }}>From<input type="date" name="from" defaultValue={from} required style={{ display: "block" }} /></label>
        <label style={{ fontSize: 12 }}>To<input type="date" name="to" defaultValue={to} required style={{ display: "block" }} /></label>
        <button type="submit" className="button-secondary" style={{ color: "var(--text)", borderColor: "var(--border)" }}>Apply</button>
      </form>
    </div>
  );
}

export type DivergingItem = { label: string; value: number; display: string };

/** Horizontal bars either side of a zero line: gains blue, losses orange. Items are drawn in the order given. */
export function DivergingBars({ items, emptyText }: { items: DivergingItem[]; emptyText: string }) {
  const max = Math.max(0, ...items.map((i) => Math.abs(i.value)));
  if (items.length === 0 || max === 0) return <Empty>{emptyText}</Empty>;
  const hasNeg = items.some((i) => i.value < 0);
  const hasPos = items.some((i) => i.value > 0);
  const zero = hasNeg && hasPos ? 50 : hasNeg ? 100 : 0; // % from the left where zero sits
  const span = hasNeg && hasPos ? 50 : 100;
  return (
    <div>
      <div className="viz-legend">
        <span style={{ ["--c" as string]: "#2a78d6" }}>Profit</span>
        <span style={{ ["--c" as string]: "#eb6834" }}>Loss</span>
      </div>
      <div className="viz-barlist">
        {items.map((i) => {
          const w = Math.max(1, (Math.abs(i.value) / max) * span);
          const neg = i.value < 0;
          return (
            <div className="viz-barlist__row" key={i.label}>
              <span>{i.label}</span>
              <div className="viz-barlist__track" title={`${i.label}: ${i.display}`} style={{ position: "relative" }}>
                {i.value !== 0 && (
                  <div className="viz-barlist__bar" style={{ position: "absolute", top: 0, bottom: 0, width: `${w}%`, left: neg ? `${zero - w}%` : `${zero}%`, background: neg ? "#eb6834" : "#2a78d6" }} />
                )}
                {hasNeg && hasPos && <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "#98a2b3" }} />}
              </div>
              <strong>{i.display}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}
