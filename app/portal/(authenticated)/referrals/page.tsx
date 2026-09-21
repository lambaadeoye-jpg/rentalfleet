import { createClient } from "@/lib/supabase/server";
import ReferralLinkBox from "./referral-link-box";

export const dynamic = "force-dynamic";

export default async function PortalReferralsPage() {
  const supabase = await createClient();

  const { data: customer } = await supabase.from("customer").select("id, referral_code").maybeSingle();

  const [{ data: referrals }, { data: ledgerEntries }] = await Promise.all([
    supabase
      .from("referral")
      .select("status, credit_amount, created_at, lead:referred_lead_id(first_name, last_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("ledger_entry")
      .select("entry_type, amount")
      .in("entry_type", ["referral_credit_earned", "referral_credit_applied"]),
  ]);

  const balance = (ledgerEntries ?? []).reduce((sum, e) => {
    return e.entry_type === "referral_credit_earned" ? sum + Number(e.amount) : sum - Number(e.amount);
  }, 0);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const referralLink = customer?.referral_code ? `${siteUrl}?ref=${customer.referral_code}` : "";

  return (
    <div style={{ padding: "24px 20px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Referrals</h1>

      <div className="card" style={{ marginBottom: 16, textAlign: "center" }}>
        <p className="muted-text" style={{ fontSize: 13, marginBottom: 4 }}>Referral Credit Balance</p>
        <p style={{ fontSize: 32, fontWeight: 800, color: "var(--teal)" }}>${balance.toFixed(2)}</p>
      </div>

      {customer?.referral_code && <ReferralLinkBox referralLink={referralLink} />}

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Your Referrals</h2>
        {!referrals?.length ? (
          <p className="muted-text" style={{ fontSize: 14 }}>
            Share your link above -- once someone you refer completes their first full paid week,
            it'll show up here.
          </p>
        ) : (
          referrals.map((r, i) => {
            const lead = r.lead as any;
            return (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 8 }}>
                <span>{lead?.first_name ?? "Someone"} {lead?.last_name ?? ""}</span>
                <span style={{ textTransform: "capitalize", fontWeight: 600 }}>
                  {r.status === "credited" ? `+$${Number(r.credit_amount).toFixed(2)}` : r.status}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
