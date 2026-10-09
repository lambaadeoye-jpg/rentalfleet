import { getServiceDue } from "./due-actions";

export default async function ServiceDue() {
  const { rows, intervalDays } = await getServiceDue();
  if (rows.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 20, borderColor: rows.some((r) => r.state === "overdue") ? "#fca5a5" : "#fcd34d" }}>
      <h2 className="card-title card-title--tight">Service due</h2>
      <p className="muted-text" style={{ fontSize: 13, marginBottom: 8 }}>Every car is serviced about every {intervalDays} days. Book each one with the renter.</p>
      {rows.map((r) => (
        <div key={r.vehicleId} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
          <span>{r.label}</span>
          <span style={{ fontWeight: 700, color: r.state === "overdue" ? "#b91c1c" : "#92400e", whiteSpace: "nowrap" }}>
            {r.state === "overdue" ? `${Math.abs(r.daysLeft)} day${Math.abs(r.daysLeft) === 1 ? "" : "s"} overdue` : r.daysLeft === 0 ? "due today" : `due in ${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"}`}
          </span>
        </div>
      ))}
    </div>
  );
}
