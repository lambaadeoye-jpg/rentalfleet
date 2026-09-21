import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import ApplyReferralCreditForm from "./apply-referral-credit-form";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: customer } = await supabase.from("customer").select("*").eq("id", id).maybeSingle();
  if (!customer) notFound();

  const [
    { data: applications },
    { data: rentals },
    { data: payments },
    { data: charges },
    { data: insurance },
    { data: documents },
    { data: drivers },
    { data: tickets },
    { data: leads },
    { data: referralLedger },
  ] = await Promise.all([
    supabase.from("application").select("id, status, submitted_at, decision_at, decision_reason").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase
      .from("rental")
      .select("id, status, start_at, expected_return_at, actual_return_at, rental_segment(vehicle:vehicle_id(make, model, year, vin))")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("payment").select("id, amount, method_type, status, paid_at").eq("customer_id", id).order("paid_at", { ascending: false }),
    supabase.from("charge").select("id, charge_type, amount, approval_status, created_at").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase.from("insurance_policy").select("id, policy_type, provider, verification_status, effective_to").eq("customer_id", id),
    supabase.from("customer_document").select("id, document_type, status, created_at").eq("customer_id", id),
    supabase.from("authorized_driver").select("id, first_name, last_name, status, license_expiry").eq("customer_id", id),
    supabase.from("support_ticket").select("id, subject, status, priority, created_at").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase.from("lead").select("id, source, campaign, stage, created_at").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase.from("ledger_entry").select("entry_type, amount").eq("customer_id", id).in("entry_type", ["referral_credit_earned", "referral_credit_applied"]),
  ]);

  const referralCreditBalance = (referralLedger ?? []).reduce((sum, e) => {
    return e.entry_type === "referral_credit_earned" ? sum + Number(e.amount) : sum - Number(e.amount);
  }, 0);

  const totalPaid = (payments ?? []).filter((p) => p.status === "paid").reduce((sum, p) => sum + Number(p.amount), 0);
  const totalCharges = (charges ?? []).reduce((sum, c) => sum + Number(c.amount), 0);

  return (
    <div style={{ padding: "32px 40px", maxWidth: 900 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>
        {customer.first_name} {customer.last_name}
      </h1>
      <p className="muted-text" style={{ marginBottom: 24 }}>
        {customer.email ?? "No email"} · {customer.phone ?? "No phone"} ·{" "}
        <span style={{ textTransform: "capitalize" }}>{customer.status}</span>
      </p>

      <div className="grid-3" style={{ marginBottom: 28 }}>
        <div className="card">
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>Total Paid</p>
          <p style={{ fontSize: 24, fontWeight: 800 }}>${totalPaid.toFixed(2)}</p>
        </div>
        <div className="card">
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>Total Charges</p>
          <p style={{ fontSize: 24, fontWeight: 800 }}>${totalCharges.toFixed(2)}</p>
        </div>
        <div className="card">
          <p className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>Rentals</p>
          <p style={{ fontSize: 24, fontWeight: 800 }}>{rentals?.length ?? 0}</p>
        </div>
      </div>

      <Section title="Lead / CRM History">
        {!leads?.length && <Empty text="No lead record on file." />}
        {leads?.map((l) => (
          <Row key={l.id}>
            <strong style={{ textTransform: "capitalize" }}>{l.stage}</strong> via {l.source ?? "unknown source"}
            {l.campaign ? ` (${l.campaign})` : ""} — {new Date(l.created_at).toLocaleDateString()}
          </Row>
        ))}
      </Section>

      <Section title="Applications">
        {!applications?.length && <Empty text="No applications on file." />}
        {applications?.map((a) => (
          <Row key={a.id}>
            <strong style={{ textTransform: "capitalize" }}>{a.status.replace(/_/g, " ")}</strong>
            {a.decision_reason ? ` — ${a.decision_reason}` : ""}
            {a.decision_at ? ` (decided ${new Date(a.decision_at).toLocaleDateString()})` : ""}
          </Row>
        ))}
      </Section>

      <Section title="Rentals">
        {!rentals?.length && <Empty text="No rentals on file." />}
        {rentals?.map((r) => {
          const segment = (r.rental_segment as any)?.[0];
          const vehicle = segment?.vehicle;
          return (
            <Row key={r.id}>
              <strong style={{ textTransform: "capitalize" }}>{r.status}</strong>
              {vehicle ? ` — ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.vin})` : ""}
              {r.actual_return_at && ` — returned ${new Date(r.actual_return_at).toLocaleDateString()}`}
            </Row>
          );
        })}
      </Section>

      <Section title="Referral Credit">
        <div style={{ padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p className="muted-text" style={{ fontSize: 13 }}>Available balance</p>
            <p style={{ fontSize: 20, fontWeight: 800 }}>${referralCreditBalance.toFixed(2)}</p>
          </div>
          {referralCreditBalance > 0 && <ApplyReferralCreditForm customerId={id} maxAmount={referralCreditBalance} />}
        </div>
      </Section>

      <Section title="Payments">        {!payments?.length && <Empty text="No payments recorded." />}
        {payments?.map((p) => (
          <Row key={p.id}>
            ${Number(p.amount).toFixed(2)} via {p.method_type} — <span style={{ textTransform: "capitalize" }}>{p.status}</span>
            {p.paid_at && ` (${new Date(p.paid_at).toLocaleDateString()})`}
          </Row>
        ))}
      </Section>

      <Section title="Charges">
        {!charges?.length && <Empty text="No charges on file." />}
        {charges?.map((c) => (
          <Row key={c.id}>
            <span style={{ textTransform: "capitalize" }}>{c.charge_type.replace(/_/g, " ")}</span> — $
            {Number(c.amount).toFixed(2)} ({c.approval_status})
          </Row>
        ))}
      </Section>

      <Section title="Insurance">
        {!insurance?.length && <Empty text="No insurance policies on file." />}
        {insurance?.map((i) => (
          <Row key={i.id}>
            <span style={{ textTransform: "capitalize" }}>{i.policy_type}</span> — {i.provider ?? "Unknown provider"} —{" "}
            <span style={{ textTransform: "capitalize" }}>{i.verification_status?.replace(/_/g, " ")}</span>
            {i.effective_to && ` (expires ${new Date(i.effective_to).toLocaleDateString()})`}
          </Row>
        ))}
      </Section>

      <Section title="Authorized Drivers">
        {!drivers?.length && <Empty text="No authorized drivers on file." />}
        {drivers?.map((d) => (
          <Row key={d.id}>
            {d.first_name} {d.last_name} — <span style={{ textTransform: "capitalize" }}>{d.status}</span>
            {d.license_expiry && ` (license expires ${new Date(d.license_expiry).toLocaleDateString()})`}
          </Row>
        ))}
      </Section>

      <Section title="Documents">
        {!documents?.length && <Empty text="No documents on file." />}
        {documents?.map((d) => (
          <Row key={d.id}>
            <span style={{ textTransform: "capitalize" }}>{d.document_type.replace(/_/g, " ")}</span> —{" "}
            <span style={{ textTransform: "capitalize" }}>{d.status}</span>
          </Row>
        ))}
      </Section>

      <Section title="Support Tickets">
        {!tickets?.length && <Empty text="No support tickets on file." />}
        {tickets?.map((t) => (
          <Row key={t.id}>
            <strong>{t.subject}</strong> — <span style={{ textTransform: "capitalize" }}>{t.status}</span> (
            {t.priority})
          </Row>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{title}</h2>
      <div className="card" style={{ padding: 0 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 14 }}>{children}</div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: "16px", color: "var(--text-secondary)", fontSize: 14 }}>{text}</div>;
}
