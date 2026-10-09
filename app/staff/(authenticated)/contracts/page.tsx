import Link from "next/link";
import { loadContracts } from "./data";
import SendAgreement from "./send-agreement";
import { STATE_LABELS, type AgreementState } from "@/lib/contracts";

export const dynamic = "force-dynamic";

const TAG: Record<AgreementState, string> = {
  signed: "tag tag--good",
  waiting: "tag tag--warn",
  expired: "tag tag--bad",
  revoked: "tag tag--bad",
  not_sent: "tag",
};

function day(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

const RENTAL_LABEL: Record<string, string> = { approved: "Approved", scheduled: "Scheduled", active: "On rent", returned: "Returned", closed: "Closed" };

export default async function ContractsPage() {
  const rows = await loadContracts();
  const flagged = rows.filter((r) => r.attention);
  const signedCount = rows.filter((r) => r.state === "signed").length;

  return (
    <div className="page">
      <h1 className="page-title">Contracts</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Every rental’s agreement: who signed, when, and which version. To send one, open the rental and use its agreement section. Edit the wording under{" "}
        <Link href="/staff/settings/agreement" style={{ color: "var(--teal-dark)", fontWeight: 600 }}>Settings → Agreement</Link>.
      </p>

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-tile__value" style={flagged.length > 0 ? { color: "var(--red)" } : undefined}>{flagged.length}</div>
          <div className="stat-tile__label">Out or scheduled, not signed</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile__value">{signedCount}</div>
          <div className="stat-tile__label">Signed</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile__value">{rows.length}</div>
          <div className="stat-tile__label">Rentals shown</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        {rows.length === 0 ? (
          <p className="muted-text" style={{ padding: 24 }}>No rentals yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>{["Renter", "Vehicle", "Rental", "Agreement", "Signed", "Version", ""].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rentalId}>
                  <td className="cell-strong">
                    {r.customerId ? <Link href={`/staff/customers/${r.customerId}`} style={{ color: "inherit" }}>{r.renter}</Link> : r.renter}
                  </td>
                  <td className="cell-muted">{r.vehicle}{r.plate ? <div style={{ fontSize: 12 }}>{r.plate}</div> : null}</td>
                  <td className="cell-muted">{RENTAL_LABEL[r.rentalStatus] ?? r.rentalStatus}</td>
                  <td>
                    <span className={TAG[r.state]}>{STATE_LABELS[r.state]}</span>
                    {r.attention && <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600, marginTop: 4 }}>Needs a signature</div>}
                    {r.linkExpiresAt && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>Link good until {day(r.linkExpiresAt)}</div>}
                  </td>
                  <td className="cell-muted">{r.signedAt ? <>{day(r.signedAt)}{r.signerName ? <div style={{ fontSize: 12 }}>{r.signerName}</div> : null}</> : "—"}</td>
                  <td className="cell-muted">{r.version != null ? `v${r.version}` : "—"}</td>
                  <td>
                    {r.downloadUrl ? (
                      <a href={r.downloadUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal-dark)", fontWeight: 600, fontSize: 13 }}>View signed copy</a>
                    ) : r.state !== "signed" && (r.rentalStatus === "approved" || r.rentalStatus === "scheduled") ? (
                      <SendAgreement rentalId={r.rentalId} hasLink={r.state === "waiting"} />
                    ) : r.state !== "signed" && r.rentalStatus === "active" ? (
                      <span className="muted-text" style={{ fontSize: 12 }}>Links can only be made before pickup</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
