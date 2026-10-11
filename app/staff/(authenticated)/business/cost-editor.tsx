"use client";

import { useState, type FormEvent } from "react";
import { saveVehicleCost } from "./actions";

export type EditorCar = {
  id: string;
  label: string;
  purchasePrice: string;
  purchasedOn: string;
  monthlyLoan: string;
  monthlyInsurance: string;
  monthlyOther: string;
  partnerSharePct: string;
  entered: boolean;
};

function CarForm({ car }: { car: EditorCar }) {
  const [state, setState] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({ busy: false, msg: null, ok: false });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState({ busy: true, msg: null, ok: false });
    const r = await saveVehicleCost({
      vehicleId: car.id,
      purchasePrice: String(f.get("purchasePrice") ?? ""),
      purchasedOn: String(f.get("purchasedOn") ?? ""),
      monthlyLoan: String(f.get("monthlyLoan") ?? ""),
      monthlyInsurance: String(f.get("monthlyInsurance") ?? ""),
      monthlyOther: String(f.get("monthlyOther") ?? ""),
      partnerSharePct: String(f.get("partnerSharePct") ?? ""),
    });
    setState({ busy: false, ok: r.success, msg: r.success ? "Saved." : r.error ?? "Couldn’t save." });
  }

  const field = { display: "block", width: "100%" } as const;
  return (
    <details className="viz-details" style={{ marginBottom: 8 }}>
      <summary>{car.label}{car.entered ? "" : " — costs not entered"}</summary>
      <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 8 }}>
        <label style={{ fontSize: 12 }}>Purchase price ($)<input name="purchasePrice" inputMode="decimal" defaultValue={car.purchasePrice} style={field} /></label>
        <label style={{ fontSize: 12 }}>Purchase date<input name="purchasedOn" type="date" defaultValue={car.purchasedOn} style={field} /></label>
        <label style={{ fontSize: 12 }}>Loan payment / month ($)<input name="monthlyLoan" inputMode="decimal" defaultValue={car.monthlyLoan} style={field} /></label>
        <label style={{ fontSize: 12 }}>Insurance / month ($)<input name="monthlyInsurance" inputMode="decimal" defaultValue={car.monthlyInsurance} style={field} /></label>
        <label style={{ fontSize: 12 }}>Registration &amp; other / month ($)<input name="monthlyOther" inputMode="decimal" defaultValue={car.monthlyOther} style={field} /></label>
        <label style={{ fontSize: 12 }}>Partner&rsquo;s share of profit (%)<input name="partnerSharePct" inputMode="decimal" defaultValue={car.partnerSharePct} style={field} /></label>
        <div style={{ alignSelf: "end" }}>
          <button type="submit" disabled={state.busy}>{state.busy ? "Saving…" : "Save"}</button>
          {state.msg ? <span className={state.ok ? "muted-text" : "error-text"} style={{ marginLeft: 8 }}>{state.msg}</span> : null}
        </div>
      </form>
    </details>
  );
}

export default function CostEditor({ cars }: { cars: EditorCar[] }) {
  if (cars.length === 0) return <p className="viz-empty">Add a vehicle in Fleet first, then enter its costs here.</p>;
  return <div>{cars.map((c) => <CarForm key={c.id} car={c} />)}</div>;
}
