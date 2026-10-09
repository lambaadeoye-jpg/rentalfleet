import { describe, expect, it } from "vitest";
import { agreementAllowsHandover, cardChargedStatus, RUNNER_NAV, runnerCanOpen } from "./runner-access";

describe("runnerCanOpen", () => {
  it("allows the runner pages and anything beneath them", () => {
    for (const p of ["/staff/pickups", "/staff/pickups/", "/staff/fleet/map", "/staff/report", "/staff/profile", "/staff/report/new"]) expect(runnerCanOpen(p)).toBe(true);
  });
  it("blocks every office page", () => {
    for (const p of ["/staff/leads", "/staff/customers", "/staff/charges", "/staff/export", "/staff/team", "/staff/pricing", "/staff/tolls", "/staff/contracts", "/staff/fleet", "/staff/fleet/gps", "/staff/fleet/maintenance", "/staff/dashboard", "/staff/inbox", "/staff"]) expect(runnerCanOpen(p)).toBe(false);
  });
  it("does not match look-alike prefixes", () => {
    expect(runnerCanOpen("/staff/pickups-archive")).toBe(false);
    expect(runnerCanOpen("/staff/fleet/map-admin")).toBe(false);
    expect(runnerCanOpen("/staff/reports")).toBe(false);
  });
  it("every nav item is an allowed page", () => {
    for (const i of RUNNER_NAV) expect(runnerCanOpen(i.href)).toBe(true);
  });
});

describe("agreementAllowsHandover", () => {
  it("needs a signed agreement", () => {
    expect(agreementAllowsHandover({ signed: true })).toEqual({ ok: true });
    expect(agreementAllowsHandover({ signed: false })).toMatchObject({ ok: false });
  });
});

describe("cardChargedStatus", () => {
  const base = { plan: "weekly" as const, weeklyRateUsd: 222, quotedAmountUsd: null, depositRequiredUsd: 150, rentPaidUsd: 0, depositPaidUsd: 0 };
  it("is unpaid until both rent and deposit are collected", () => {
    expect(cardChargedStatus(base)).toEqual({ rentPaid: false, depositPaid: false, allPaid: false });
    expect(cardChargedStatus({ ...base, rentPaidUsd: 222 })).toEqual({ rentPaid: true, depositPaid: false, allPaid: false });
    expect(cardChargedStatus({ ...base, rentPaidUsd: 222, depositPaidUsd: 150 }).allPaid).toBe(true);
  });
  it("uses the quoted total for daily rentals", () => {
    expect(cardChargedStatus({ ...base, plan: "daily", weeklyRateUsd: null, quotedAmountUsd: 180, rentPaidUsd: 180, depositPaidUsd: 150 }).allPaid).toBe(true);
    expect(cardChargedStatus({ ...base, plan: "daily", weeklyRateUsd: null, quotedAmountUsd: 180, rentPaidUsd: 100, depositPaidUsd: 150 }).rentPaid).toBe(false);
  });
  it("older rentals with no recorded deposit need any payment", () => {
    expect(cardChargedStatus({ ...base, depositRequiredUsd: null }).allPaid).toBe(false);
    expect(cardChargedStatus({ ...base, depositRequiredUsd: null, rentPaidUsd: 50 }).allPaid).toBe(true);
  });
});
