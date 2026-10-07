import { describe, it, expect } from "vitest";
import { noticeBody, decideNotice, dollars, type NoticeRow } from "./renter-notices";

const row = (over: Partial<NoticeRow> = {}): NoticeRow => ({ kind: "payment_received", data: { rent_cents: 45000, deposit_cents: 45000 }, first_name: "Ann", phone: "+16155550123", suppressed: false, ...over });
// Noon in Nashville (CDT): inside any sensible send window.
const NOON = new Date("2026-10-07T17:00:00Z");
const NIGHT = new Date("2026-10-07T07:00:00Z"); // 2 AM Nashville

describe("noticeBody", () => {
  it("formats dollars", () => {
    expect(dollars(45000)).toBe("$450.00");
    expect(dollars("abc")).toBe("$0.00");
  });
  it("cancelled with a refund promises a text, not a date", () => {
    const t = noticeBody("cancelled", { total_refund_cents: 9000 }, null)!;
    expect(t).toContain("$90.00");
    expect(t).toContain("will text you when it's issued");
    expect(t).toContain("Reply STOP");
  });
  it("cancelled with nothing owed says so", () => {
    expect(noticeBody("cancelled", { total_refund_cents: 0 }, null)).toContain("No refund is due");
  });
  it("refund timing only when it went to the card", () => {
    expect(noticeBody("refund_sent", { total_refund_cents: 9000, manual_cents: 0 }, null)).toContain("5 to 10 business days");
    expect(noticeBody("refund_sent", { total_refund_cents: 9000, manual_cents: 9000 }, null)).not.toContain("business days");
    expect(noticeBody("refund_sent", { total_refund_cents: 0 }, null)).toBeNull();
  });
  it("payment receipt splits rent and deposit", () => {
    const t = noticeBody("payment_received", { rent_cents: 45000, deposit_cents: 45000 }, null)!;
    expect(t).toContain("$900.00");
    expect(t).toContain("$450.00 rent + $450.00 refundable deposit");
  });
  it("failed charge adds support contact when known", () => {
    expect(noticeBody("weekly_charge_failed", { amount_cents: 45000 }, "615-555-0100")).toContain("Questions? 615-555-0100.");
    expect(noticeBody("weekly_charge_failed", { amount_cents: 45000 }, null)).not.toContain("Questions?");
  });
  it("never promises timing for approval or pickup", () => {
    for (const k of ["cancelled", "payment_received", "weekly_rent_charged", "weekly_charge_failed"] as const) {
      expect(noticeBody(k, { total_refund_cents: 100, rent_cents: 100, amount_cents: 100 }, null)).not.toMatch(/within \d+ ?(hours|days)|guarantee/i);
    }
  });
});

describe("decideNotice", () => {
  it("sends in the daytime", () => {
    const d = decideNotice(row(), NOON, true, null);
    expect(d.action).toBe("send");
  });
  it("skips suppressed numbers and missing phones", () => {
    expect(decideNotice(row({ suppressed: true }), NOON, true, null)).toEqual({ action: "skip", reason: "suppressed" });
    expect(decideNotice(row({ phone: null }), NOON, true, null)).toEqual({ action: "skip", reason: "no_phone" });
  });
  it("defers with no provider or at night", () => {
    expect(decideNotice(row(), NOON, false, null).action).toBe("defer");
    expect(decideNotice(row(), NIGHT, true, null)).toEqual({ action: "defer", reason: "quiet_hours" });
  });
});
