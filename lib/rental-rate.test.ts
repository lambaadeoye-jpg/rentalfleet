import { describe, it, expect } from "vitest";
import { computeWeeklyRate, computeDailyTotal, resolveDeposit } from "./rental-rate";

const rules = { insured_discount_pct: 22, uninsured_weekly_deduction_usd: 60, approved: true };

describe("computeWeeklyRate", () => {
  it("gives the insured discount (22% off 450 = 351)", () => {
    const r = computeWeeklyRate(450, "own", rules);
    expect(r).toEqual({ ok: true, amount: 351, base: 450, adjustment: -99 });
  });
  it("takes the fixed insurance amount off when the renter buys cover (450 - 60 = 390)", () => {
    const r = computeWeeklyRate(450, "via_provider", rules);
    expect(r).toEqual({ ok: true, amount: 390, base: 450, adjustment: -60 });
  });
  it("uses an admin-changed percentage", () => {
    const r = computeWeeklyRate(450, "own", { ...rules, insured_discount_pct: 10 });
    expect(r.ok && r.amount).toBe(405);
  });
  it("refuses when rules are not approved or missing", () => {
    expect(computeWeeklyRate(450, "own", { ...rules, approved: false }).ok).toBe(false);
    expect(computeWeeklyRate(450, "own", null).ok).toBe(false);
    expect(computeWeeklyRate(450, "via_provider", { ...rules, uninsured_weekly_deduction_usd: null }).ok).toBe(false);
    expect(computeWeeklyRate(450, "own", { ...rules, insured_discount_pct: null }).ok).toBe(false);
  });
  it("refuses a missing weekly rate and a result at or below zero", () => {
    expect(computeWeeklyRate(null, "own", rules).ok).toBe(false);
    expect(computeWeeklyRate(50, "via_provider", rules).ok).toBe(false);
    expect(computeWeeklyRate(450, "own", { ...rules, insured_discount_pct: 100 }).ok).toBe(false);
  });
});

describe("computeDailyTotal", () => {
  it("discounts the 7-day total (516 at 22% = 402.48)", () => {
    const r = computeDailyTotal(516, 7, "own", rules);
    expect(r).toEqual({ ok: true, amount: 402.48, base: 516, adjustment: -113.52 });
  });
  it("converts the weekly deduction to per-day for the billable days", () => {
    expect(computeDailyTotal(516, 7, "via_provider", rules)).toMatchObject({ ok: true, amount: 456 });
    const ten = computeDailyTotal(738, 10, "via_provider", rules);
    expect(ten.ok && ten.amount).toBe(652.29);
  });
  it("refuses bad inputs", () => {
    expect(computeDailyTotal(null, 7, "own", rules).ok).toBe(false);
    expect(computeDailyTotal(516, 0, "own", rules).ok).toBe(false);
  });
});

describe("resolveDeposit", () => {
  it("accepts an approved amount in range", () => {
    expect(resolveDeposit({ amount_usd: 150, approved: true })).toEqual({ ok: true, amount: 150 });
    expect(resolveDeposit({ amount_usd: 100, approved: true }).ok).toBe(true);
    expect(resolveDeposit({ amount_usd: 200, approved: true }).ok).toBe(true);
  });
  it("rejects out-of-range, unapproved or missing", () => {
    expect(resolveDeposit({ amount_usd: 99.99, approved: true }).ok).toBe(false);
    expect(resolveDeposit({ amount_usd: 250, approved: true }).ok).toBe(false);
    expect(resolveDeposit({ amount_usd: 150, approved: false }).ok).toBe(false);
    expect(resolveDeposit({ amount_usd: null, approved: true }).ok).toBe(false);
    expect(resolveDeposit(null).ok).toBe(false);
  });
});
