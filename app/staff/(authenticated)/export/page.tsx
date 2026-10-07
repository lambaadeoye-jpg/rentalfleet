import ExportButtons from "./export-buttons";

export const dynamic = "force-dynamic";

export default function ExportPage() {
  return (
    <div className="page">
      <h1 className="page-title">Data export</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Downloads a CSV of everything currently in each table. Scoped to what’s real right now —
        invoices and formal reports need a payment processor first.
      </p>
      <ExportButtons />
    </div>
  );
}
