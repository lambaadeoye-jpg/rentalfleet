"use client";

import { useState } from "react";
import { updatePricingRules, type PricingRules } from "./actions";

export default function PricingForm({ initialRules }: { initialRules: PricingRules }) {
  const [rules, setRules] = useState<PricingRules>(initialRules);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setError(null);
    setSaved(false);
    setLoading(true);
    const result = await updatePricingRules(rules);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn’t save. Please try again.");
      return;
    }
    setSaved(true);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 560 }}>
      {/* DAILY */}
      <div className="card">
        <h2 className="card-title card-title--tight">Daily Rental</h2>
        <p className="muted-text" style={{ fontSize: 13, marginBottom: 16 }}>
          A locked business rule (V2.1) — shown here for visibility and future flexibility,
          already active.
        </p>
        <div className="form-row">
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>First tier (days)</span>
            <input
              type="number"
              value={rules.daily.first_tier_days}
              onChange={(e) => setRules({ ...rules, daily: { ...rules.daily, first_tier_days: Number(e.target.value) } })}
            />
          </label>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>First tier total ($)</span>
            <input
              type="number"
              value={rules.daily.first_tier_total_usd}
              onChange={(e) => setRules({ ...rules, daily: { ...rules.daily, first_tier_total_usd: Number(e.target.value) } })}
            />
          </label>
        </div>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Per day after ($)</span>
          <input
            type="number"
            value={rules.daily.per_day_after_usd}
            onChange={(e) => setRules({ ...rules, daily: { ...rules.daily, per_day_after_usd: Number(e.target.value) } })}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={rules.daily.approved}
            onChange={(e) => setRules({ ...rules, daily: { ...rules.daily, approved: e.target.checked } })}
          />
          Approved for use (unchecking this stops new daily rentals from getting a quoted price)
        </label>
      </div>

      {/* WEEKLY */}
      <div className="card">
        <h2 className="card-title card-title--tight">Weekly Rental</h2>
        <p className="muted-text" style={{ fontSize: 13, marginBottom: 16 }}>
          Not yet approved — no weekly rentals will get a payment schedule until you set a real
          rate and check the box below.
        </p>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Weekly rate ($)</span>
          <input
            type="number"
            value={rules.weekly_rate_usd ?? ""}
            onChange={(e) => setRules({ ...rules, weekly_rate_usd: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={rules.weekly_approved}
            onChange={(e) => setRules({ ...rules, weekly_approved: e.target.checked })}
          />
          Approved for use
        </label>
      </div>

      {/* DEPOSIT */}
      <div className="card">
        <h2 className="card-title card-title--tight">Refundable deposit</h2>
        <p className="muted-text" style={{ fontSize: 13, marginBottom: 16 }}>
          One amount for every renter, between $100 and $200. Separate from rent; both are
          collected before pickup. Card only (renter&rsquo;s own name) — no cash.
        </p>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Deposit ($100-$200)</span>
          <input
            type="number"
            min={100}
            max={200}
            value={rules.deposit.amount_usd ?? ""}
            onChange={(e) => setRules({ ...rules, deposit: { ...rules.deposit, amount_usd: e.target.value ? Number(e.target.value) : null } })}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={rules.deposit.approved}
            onChange={(e) => setRules({ ...rules, deposit: { ...rules.deposit, approved: e.target.checked } })}
          />
          Approved for use (rentals can&rsquo;t be scheduled until this is set and approved)
        </label>
      </div>

      {/* INSURANCE */}
      <div className="card">
        <h2 className="card-title card-title--tight">Insurance pricing (staff only)</h2>
        <p className="muted-text" style={{ fontSize: 13, marginBottom: 16 }}>
          Renters with their own insurance get a percentage off the rental fee. Renters without
          insurance buy cover themselves from a provider (Bonzah, RentalCover, ...) and pay
          that provider directly, so a fixed weekly amount comes off what they pay us. Applies
          to both daily and weekly rentals (daily uses the weekly amount / 7 per day). Renters
          aren&rsquo;t shown this — staff communicate the final numbers after approval.
        </p>
        <div className="form-row">
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Own insurance: discount (%)</span>
            <input
              type="number"
              min={0}
              max={99}
              value={rules.insurance.insured_discount_pct ?? ""}
              onChange={(e) => setRules({ ...rules, insurance: { ...rules.insurance, insured_discount_pct: e.target.value ? Number(e.target.value) : null } })}
            />
          </label>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>No insurance: weekly deduction ($)</span>
            <input
              type="number"
              min={0}
              value={rules.insurance.uninsured_weekly_deduction_usd ?? ""}
              onChange={(e) =>
                setRules({ ...rules, insurance: { ...rules.insurance, uninsured_weekly_deduction_usd: e.target.value ? Number(e.target.value) : null } })
              }
            />
          </label>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={rules.insurance.approved}
            onChange={(e) => setRules({ ...rules, insurance: { ...rules.insurance, approved: e.target.checked } })}
          />
          Approved for use (rentals can&rsquo;t be scheduled until this is set and approved)
        </label>
      </div>

      {/* CANCELLATION AND REFUNDS */}
      <div className="card">
        <h2 className="card-title card-title--tight">Cancellation &amp; refunds</h2>
        <p className="muted-text" style={{ fontSize: 13, marginBottom: 16 }}>
          Money paid before pickup is refunded to the original card. Fees come out of the rent
          only; the deposit is always refunded in full before pickup. After pickup a started
          week is not prorated. Each rental keeps a snapshot of these numbers.
        </p>
        <div className="form-row">
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Late cancel / no-show fee ($)</span>
            <input
              type="number"
              min={0}
              value={rules.cancellation.late_fee_usd ?? ""}
              onChange={(e) => setRules({ ...rules, cancellation: { ...rules.cancellation, late_fee_usd: e.target.value ? Number(e.target.value) : null } })}
            />
          </label>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Early cancel fee after free ones ($)</span>
            <input
              type="number"
              min={0}
              value={rules.cancellation.early_fee_usd ?? ""}
              onChange={(e) => setRules({ ...rules, cancellation: { ...rules.cancellation, early_fee_usd: e.target.value ? Number(e.target.value) : null } })}
            />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Free cancellations per 90 days</span>
            <input
              type="number"
              min={0}
              value={rules.cancellation.free_cancellations_per_90d}
              onChange={(e) => setRules({ ...rules, cancellation: { ...rules.cancellation, free_cancellations_per_90d: Number(e.target.value) } })}
            />
          </label>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Late window (hours before pickup)</span>
            <input
              type="number"
              min={1}
              value={rules.cancellation.late_window_hours}
              onChange={(e) => setRules({ ...rules, cancellation: { ...rules.cancellation, late_window_hours: Number(e.target.value) } })}
            />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>No-show grace (hours)</span>
            <input
              type="number"
              min={0}
              value={rules.cancellation.noshow_grace_hours}
              onChange={(e) => setRules({ ...rules, cancellation: { ...rules.cancellation, noshow_grace_hours: Number(e.target.value) } })}
            />
          </label>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Rebook window after no-show (days)</span>
            <input
              type="number"
              min={1}
              value={rules.cancellation.rebook_days}
              onChange={(e) => setRules({ ...rules, cancellation: { ...rules.cancellation, rebook_days: Number(e.target.value) } })}
            />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Tolls/tickets charge window (days after return)</span>
            <input
              type="number"
              min={7}
              value={rules.cancellation.toll_ticket_window_days}
              onChange={(e) => setRules({ ...rules, cancellation: { ...rules.cancellation, toll_ticket_window_days: Number(e.target.value) } })}
            />
          </label>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Admin approval above ($)</span>
            <input
              type="number"
              min={0}
              value={rules.cancellation.admin_approval_threshold_usd}
              onChange={(e) => setRules({ ...rules, cancellation: { ...rules.cancellation, admin_approval_threshold_usd: Number(e.target.value) } })}
            />
          </label>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={rules.cancellation.approved}
            onChange={(e) => setRules({ ...rules, cancellation: { ...rules.cancellation, approved: e.target.checked } })}
          />
          Approved for use
        </label>
      </div>

      {/* LATE FEE */}
      <div className="card">
        <h2 className="card-title card-title--tight">Late fee</h2>
        <p className="muted-text" style={{ fontSize: 13, marginBottom: 16 }}>
          Grace period of 0 means the fee applies starting the day after the due date, per your
          instruction.
        </p>
        <div className="form-row">
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Grace period (days)</span>
            <input
              type="number"
              value={rules.late_fee.grace_days}
              onChange={(e) => setRules({ ...rules, late_fee: { ...rules.late_fee, grace_days: Number(e.target.value) } })}
            />
          </label>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Fee amount ($)</span>
            <input
              type="number"
              value={rules.late_fee.amount_usd ?? ""}
              onChange={(e) =>
                setRules({ ...rules, late_fee: { ...rules.late_fee, amount_usd: e.target.value ? Number(e.target.value) : null } })
              }
            />
          </label>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={rules.late_fee.approved}
            onChange={(e) => setRules({ ...rules, late_fee: { ...rules.late_fee, approved: e.target.checked } })}
          />
          Approved for use (late fees won&rsquo;t auto-apply until this is checked and an amount is set)
        </label>
      </div>

      {/* REFERRAL */}
      <div className="card">
        <h2 className="card-title card-title--tight">Referral bonus</h2>
        <p className="muted-text" style={{ fontSize: 13, marginBottom: 16 }}>
          Paid to the referrer once the referred renter completes their first full paid week.
          Requires staff approval before it becomes usable, even once set here.
        </p>
        <div className="form-row">
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Bonus amount ($)</span>
            <input
              type="number"
              value={rules.referral.bonus_usd ?? ""}
              onChange={(e) =>
                setRules({ ...rules, referral: { ...rules.referral, bonus_usd: e.target.value ? Number(e.target.value) : null } })
              }
            />
          </label>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Cap</span>
            <select
              value={rules.referral.cap_type}
              onChange={(e) => setRules({ ...rules, referral: { ...rules.referral, cap_type: e.target.value as "unlimited" | "per_period" } })}
            >
              <option value="unlimited">Unlimited</option>
              <option value="per_period">Capped per period</option>
            </select>
          </label>
        </div>
        {rules.referral.cap_type === "per_period" && (
          <div className="form-row">
            <label className="field">
              <span style={{ fontSize: 13, fontWeight: 600 }}>Max $ per period</span>
              <input
                type="number"
                value={rules.referral.cap_amount_usd ?? ""}
                onChange={(e) =>
                  setRules({
                    ...rules,
                    referral: { ...rules.referral, cap_amount_usd: e.target.value ? Number(e.target.value) : null },
                  })
                }
              />
            </label>
            <label className="field">
              <span style={{ fontSize: 13, fontWeight: 600 }}>Period length (days)</span>
              <input
                type="number"
                value={rules.referral.cap_period_days ?? ""}
                onChange={(e) =>
                  setRules({
                    ...rules,
                    referral: { ...rules.referral, cap_period_days: e.target.value ? Number(e.target.value) : null },
                  })
                }
                placeholder="e.g. 30"
              />
            </label>
          </div>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={rules.referral.approved}
            onChange={(e) => setRules({ ...rules, referral: { ...rules.referral, approved: e.target.checked } })}
          />
          Approved for use (referrals won&rsquo;t be approvable on the Referrals page until this is checked and an amount is set)
        </label>
      </div>

      {error && <p className="error-text">{error}</p>}
      {saved && <p style={{ color: "var(--signal-green, #16a34a)", fontSize: 14 }}>Saved.</p>}

      <button onClick={handleSave} disabled={loading} className="button-primary" style={{ alignSelf: "flex-start" }}>
        {loading ? "Saving..." : "Save pricing"}
      </button>
    </div>
  );
}
