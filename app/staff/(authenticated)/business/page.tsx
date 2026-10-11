import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PRESET_DAYS, changePct, formatMoney, isoDay, parseRange, pct } from "@/lib/analytics";
import { BarList, ChartCard, ColumnChart, DataTable, DivergingBars, Empty, PercentLine, RangeBar, Tile } from "../../charts";
import { carProfitTotals } from "@/lib/car-profit";
import CostEditor, { type EditorCar } from "./cost-editor";
import { isAdmin, loadBusiness, loadCarProfit } from "./data";

export const dynamic = "force-dynamic";

const ASSISTANT_LABEL: Record<string, string> = { new_lead: "New lead", nudge: "Application nudge", front_desk: "Front desk", pickup: "Pickup reminder" };

function delta(current: number, previous: number): string | undefined {
  const c = changePct(current, previous);
  return c === null ? "nothing earlier to compare" : `${c >= 0 ? "+" : ""}${c}% vs the previous period`;
}

export default async function BusinessPage({ searchParams }: { searchParams: Promise<{ days?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  if (!(await isAdmin(supabase))) redirect("/staff/dashboard");

  const range = parseRange(sp);
  const [d, car] = await Promise.all([loadBusiness(supabase, range), loadCarProfit(supabase, range)]);
  const carTotals = carProfitTotals(car.rows);
  const costById = new Map(car.costs.map((c) => [c.vehicle_id, c]));
  const editorCars: EditorCar[] = car.rows
    .map((r) => {
      const c = costById.get(r.id);
      const v = (x: unknown) => (x === null || x === undefined || Number(x) === 0 ? "" : String(Number(x)));
      return { id: r.id, label: r.label, entered: !!c, purchasePrice: v(c?.purchase_price), purchasedOn: c?.purchased_on ?? "", monthlyLoan: v(c?.monthly_loan), monthlyInsurance: v(c?.monthly_insurance), monthlyOther: v(c?.monthly_other), partnerSharePct: v(c?.partner_share_pct) };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const toIncl = new Date(range.to.getTime() - 24 * 60 * 60 * 1000);
  const exportQs = new URLSearchParams(range.key === "custom" ? { from: isoDay(range.from), to: isoDay(toIncl) } : { days: range.key }).toString();

  const weeks = d.cash.weeks;
  const anyFunnel = d.funnel.some((f) => f.leads > 0);

  return (
    <div className="page viz" style={{ maxWidth: 1040 }}>
      <h1 className="page-title">Business</h1>
      <p className="muted-text" style={{ marginBottom: 16 }}>
        Money, fleet use, lead sources and AI calls for {range.label.toLowerCase()}. Weeks start on Monday. Only you can see this page.
      </p>
      <RangeBar basePath="/staff/business" activeKey={range.key} from={isoDay(range.from)} to={isoDay(toIncl)} presets={PRESET_DAYS} />
      {d.errors > 0 && <p className="error-text" style={{ marginBottom: 12 }}>Some numbers couldn&rsquo;t be loaded. Refresh to try again.</p>}

      <div className="viz-tiles">
        <Tile label="Rent collected" value={formatMoney(d.cash.rent)} sub={delta(d.cash.rent, d.prevCash.rent)} />
        <Tile label="Refunded (rent)" value={formatMoney(d.cash.refunds)} sub={delta(d.cash.refunds, d.prevCash.refunds)} />
        <Tile label="Net after refunds" value={formatMoney(d.cash.net)} sub={delta(d.cash.net, d.prevCash.net)} />
        <Tile label="Late or failing rent" value={formatMoney(d.collections.atRisk)} sub={`${d.collections.atRiskCount} payment${d.collections.atRiskCount === 1 ? "" : "s"}`} />
        <Tile label="Rent coming up" value={formatMoney(d.collections.upcoming)} sub="scheduled or processing" />
        <Tile label="Deposits held" value={formatMoney(d.depositsHeld)} sub="not income; owed back to renters" />
      </div>

      <ChartCard title="Rent collected and refunded by week" subtitle="Cash actually received for rent, against rent refunded. Deposits are not counted as income.">
        <ColumnChart
          labels={weeks.map((w) => w.start)}
          series={[
            { name: "Rent collected", color: "var(--series-1)", values: weeks.map((w) => w.rent) },
            { name: "Rent refunded", color: "var(--series-2)", values: weeks.map((w) => w.refunds) },
          ]}
          money
          emptyText="No rent collected in this period yet. This fills in as renters pay."
          tableTitle="Rent collected and refunded by week"
        />
        <p className="muted-text" style={{ fontSize: 12, marginTop: 8 }}>
          Booked-versus-collected by week comes later, from the payment schedule. For now, what is owed but not yet collected is shown in the tiles above.
        </p>
      </ChartCard>

      <div className="viz-grid-2">
        <ChartCard title="Fleet utilization" subtitle={`Share of car-days out on rent, per week (${d.fleetSize} car${d.fleetSize === 1 ? "" : "s"} in the fleet today).`}>
          <PercentLine
            labels={d.utilization.map((u) => u.start)}
            values={d.utilization.map((u) => u.pct)}
            color="var(--series-1)"
            emptyText="No rentals have been picked up in this period yet."
            tableTitle="Fleet utilization by week"
          />
        </ChartCard>

        <ChartCard title="Collections" subtitle="Rent payments right now.">
          <BarList
            items={[
              { label: "Collected this period", value: d.collections.paidThisPeriod, display: formatMoney(d.collections.paidThisPeriod), color: "var(--series-1)" },
              { label: "Coming up", value: d.collections.upcoming, display: formatMoney(d.collections.upcoming), color: "var(--series-3)" },
              { label: "Late or failing", value: d.collections.atRisk, display: formatMoney(d.collections.atRisk), color: "var(--series-2)" },
            ]}
            emptyText="No rent payments yet."
          />
        </ChartCard>
      </div>

      <ChartCard title="Which lead sources turn into renters" subtitle={`Leads created in the last ${d.funnelDays} days (since the start of your range), by where they came from. Judge a source on at least 20 to 30 leads.`}>
        {!anyFunnel ? (
          <Empty>No leads in this period yet.</Empty>
        ) : (
          <>
            <BarList
              items={d.funnel.map((f) => ({
                label: f.label,
                value: f.pickedUp,
                display: `${f.pickedUp} of ${f.leads} picked up${pct(f.pickedUp, f.leads) !== null ? ` (${pct(f.pickedUp, f.leads)}%)` : ""}`,
                href: `/staff/funnel?days=${Math.min(90, Math.max(7, d.funnelDays))}`,
              }))}
              emptyText="No renter has picked up a car from these leads yet. The table below shows where leads are getting stuck."
            />
            <DataTable
              title="Lead sources"
              headers={["Source", "Leads", "Applied", "Approved", "Picked up", "Lead to picked up"]}
              rows={d.funnel.map((f) => [f.label, f.leads, f.applied, f.approved, f.pickedUp, pct(f.pickedUp, f.leads) === null ? "–" : `${pct(f.pickedUp, f.leads)}%`])}
            />
            <p className="muted-text" style={{ fontSize: 12, marginTop: 8 }}>Spend per source (cost per lead and per picked-up renter) arrives with the ad-spend entry in Phase 3.</p>
          </>
        )}
      </ChartCard>

      <ChartCard title="AI calls" subtitle="Calls reviewed in the period, and how many moved the caller forward (application finished, a time committed, or pickup confirmed).">
        {d.calls.total === 0 ? (
          <Empty>No calls recorded in this period yet.</Empty>
        ) : (
          <>
            <BarList
              items={d.calls.byAssistant.map((a) => ({
                label: ASSISTANT_LABEL[a.assistant] ?? a.assistant,
                value: a.calls,
                display: `${a.calls} calls · ${a.positive} moved forward${a.needsHuman ? ` · ${a.needsHuman} need a person` : ""}`,
              }))}
              emptyText="No calls yet."
            />
            <DataTable
              title="AI calls by assistant"
              headers={["Assistant", "Calls", "Moved forward", "Need a person"]}
              rows={d.calls.byAssistant.map((a) => [ASSISTANT_LABEL[a.assistant] ?? a.assistant, a.calls, a.positive, a.needsHuman])}
            />
          </>
        )}
      </ChartCard>

      <ChartCard title="Which cars are losing money" subtitle={`Profit per car for ${range.label.toLowerCase()}, worst first. Real cash costs only, no depreciation. Only you can see this.`}>
        {!car.costsReady && <p className="error-text">Car costs aren&rsquo;t set up in the database yet, so only revenue is shown.</p>}
        {car.errors > 0 && <p className="error-text">Some car numbers couldn&rsquo;t be loaded. Refresh to try again.</p>}
        {car.rows.length > 0 && car.rows.some((r) => !r.hasCosts) && (
          <p className="muted-text" style={{ marginBottom: 8 }}>
            {car.rows.filter((r) => !r.hasCosts).length} car(s) have no costs entered, so their profit looks better than it is. Enter them below.
          </p>
        )}
        <div className="viz-tiles">
          <Tile label="Car revenue" value={formatMoney(carTotals.revenue)} />
          <Tile label="Cash costs" value={formatMoney(carTotals.costs)} />
          <Tile label="Profit before partner" value={formatMoney(carTotals.before)} />
          <Tile label="Profit after partner" value={formatMoney(carTotals.after)} sub={carTotals.partnerShare > 0 ? `${formatMoney(carTotals.partnerShare)} to partners` : "no partner shares entered"} />
          <Tile label="Cars losing money" value={String(carTotals.losing)} />
        </div>
        <DivergingBars
          items={car.rows.map((r) => ({ label: r.label, value: r.before, display: `${formatMoney(r.before)}${r.partnerPct > 0 ? ` (${formatMoney(r.after)} after partner)` : ""}` }))}
          emptyText="No cars yet, or nothing collected or spent on them in this period."
        />
        {car.rows.length > 0 && (
          <DataTable
            title="Profit per car"
            headers={["Car", "Revenue", "Maintenance", "Tolls & tickets", "Loan", "Insurance", "Other", "Profit before partner", "Partner %", "Profit after partner"]}
            rows={car.rows.map((r) => [r.label, formatMoney(r.revenue), formatMoney(r.maintenance), formatMoney(r.tolls), formatMoney(r.loan), formatMoney(r.insurance), formatMoney(r.other), formatMoney(r.before), `${r.partnerPct}%`, formatMoney(r.after)])}
          />
        )}
        <h3 style={{ marginTop: 16, fontSize: 15 }}>Enter or change a car&rsquo;s costs</h3>
        {car.costsReady ? <CostEditor cars={editorCars} /> : <p className="viz-empty">Available once the cost table is added to the database.</p>}
      </ChartCard>

      <p style={{ fontSize: 14 }}>
        Download as spreadsheet:{" "}
        <a href={`/staff/business/export?kind=cash&${exportQs}`}>weekly money</a> ·{" "}
        <a href={`/staff/business/export?kind=funnel&${exportQs}`}>lead sources</a> ·{" "}
        <a href={`/staff/business/export?kind=calls&${exportQs}`}>AI calls</a>
      </p>
    </div>
  );
}
