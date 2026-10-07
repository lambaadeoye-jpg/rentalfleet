import { createClient } from "@/lib/supabase/server";
import { getMyGeneratedDocuments } from "./documents-actions";
import GeneratedDocumentsList from "./generated-documents-list";
import UpdateCardButton from "./update-card-button";
import { sentenceCase } from "@/lib/format-label";

export const dynamic = "force-dynamic";

export default async function PortalMoneyPage() {
  const supabase = await createClient();

  const [{ data: deposits }, { data: charges }, { data: payments }, documents] = await Promise.all([
    supabase.from("deposit").select("amount_collected, status, refunded_at").order("id", { ascending: false }),
    supabase.from("charge").select("charge_type, amount, approval_status, created_at").order("created_at", { ascending: false }),
    supabase.from("payment").select("amount, status, paid_at, method_type").order("paid_at", { ascending: false, nullsFirst: false }),
    getMyGeneratedDocuments(),
  ]);

  return (
    <div style={{ padding: "24px 20px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Money</h1>

      <UpdateCardButton />

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Security deposit</h2>
        {deposits && deposits.length > 0 ? (
          deposits.map((d, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span>{sentenceCase(d.status)}</span>
              <span style={{ fontWeight: 700 }}>${Number(d.amount_collected).toFixed(2)}</span>
            </div>
          ))
        ) : (
          <p className="muted-text" style={{ fontSize: 14 }}>No deposit on file.</p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Charges</h2>
        {charges && charges.length > 0 ? (
          charges.map((c, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 }}>
              <span>{sentenceCase(c.charge_type.replace(/_/g, " "))}</span>
              <span style={{ fontWeight: 700 }}>${Number(c.amount).toFixed(2)}</span>
            </div>
          ))
        ) : (
          <p className="muted-text" style={{ fontSize: 14 }}>No charges yet.</p>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Payment history</h2>
        {payments && payments.length > 0 ? (
          payments.map((p, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 }}>
              <span className="muted-text">
                {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : "Scheduled"}
              </span>
              <span style={{ fontWeight: 700 }}>${Number(p.amount).toFixed(2)}</span>
            </div>
          ))
        ) : (
          <p className="muted-text" style={{ fontSize: 14 }}>No payments yet.</p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Documents</h2>
        <GeneratedDocumentsList documents={documents} />
      </div>

      <a
        href="/portal/referrals"
        className="card"
        style={{ display: "block", textAlign: "center", color: "var(--teal)", fontWeight: 700, fontSize: 14, textDecoration: "none" }}
      >
        Refer a driver, earn credit toward your rent →
      </a>
    </div>
  );
}
