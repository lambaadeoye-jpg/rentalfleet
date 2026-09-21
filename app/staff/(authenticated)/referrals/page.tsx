import { getQualifiedReferrals, getReferralBonusAmount } from "./actions";
import ReferralApprovalList from "./referral-approval-list";

export const dynamic = "force-dynamic";

export default async function ReferralsPage() {
  const [referrals, bonusAmount] = await Promise.all([getQualifiedReferrals(), getReferralBonusAmount()]);

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Referrals</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Qualified once the referred renter completes their first full paid week. Approving issues
        a real credit to the referrer's account.
      </p>

      {!bonusAmount && (
        <div className="card" style={{ marginBottom: 20, borderColor: "var(--warning, #f59e0b)" }}>
          <p style={{ fontSize: 14 }}>
            No referral bonus amount is approved yet — set one on{" "}
            <a href="/staff/pricing" style={{ color: "var(--teal)" }}>
              Pricing
            </a>{" "}
            before any referrals can be approved.
          </p>
        </div>
      )}

      <ReferralApprovalList referrals={referrals} bonusAmount={bonusAmount} />
    </div>
  );
}
