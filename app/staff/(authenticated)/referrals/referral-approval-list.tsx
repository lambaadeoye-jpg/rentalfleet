"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { approveReferral, type PendingReferral } from "./actions";

export default function ReferralApprovalList({
  referrals,
  bonusAmount,
}: {
  referrals: PendingReferral[];
  bonusAmount: number | null;
}) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove(referral: PendingReferral) {
    const confirmed = window.confirm(
      `Approve $${bonusAmount} referral credit for ${referral.referrerName} (referred ${referral.referredName})? This issues a real credit to their account.`
    );
    if (!confirmed) return;

    setError(null);
    setLoadingId(referral.id);
    const result = await approveReferral(referral.id);
    setLoadingId(null);

    if (!result.success) {
      setError(result.error ?? "Couldn't approve that referral.");
      return;
    }
    router.refresh();
  }

  if (referrals.length === 0) {
    return <p className="muted-text" style={{ fontSize: 14 }}>No referrals awaiting approval right now.</p>;
  }

  return (
    <div>
      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
      {referrals.map((r) => (
        <div key={r.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700 }}>{r.referrerName}</div>
            <div className="muted-text" style={{ fontSize: 13 }}>
              Referred {r.referredName}
              {r.qualifiedAt && ` — qualified ${new Date(r.qualifiedAt).toLocaleDateString()}`}
            </div>
          </div>
          <button
            onClick={() => handleApprove(r)}
            disabled={loadingId === r.id || !bonusAmount}
            className="button-primary"
          >
            {loadingId === r.id ? "Approving..." : `Approve $${bonusAmount ?? "—"}`}
          </button>
        </div>
      ))}
    </div>
  );
}
